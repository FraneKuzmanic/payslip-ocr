import {
  CRITICAL_FIELDS,
  addAmounts,
  amountsAgreeToTheCent,
  compareAmounts,
  subtractAmounts,
  type CanonicalPayslipFields,
  type PayslipWarning,
  type TablesStatus,
} from "@payslip/shared";
import { isValidOib } from "./oib.js";

/**
 * The warning rules of PRD §7.9, as a pure function of an extracted payslip.
 *
 * Warnings are computed on every read and never stored (Task 06 D1): the two extraction passes
 * merge independently, so a stored copy could race between them and go stale. Arithmetic
 * compares with an absolute tolerance, never a relative one: values agree only to the cent
 * (Task 06 D3). No rule here ever blocks a status change; a warning only asks for attention.
 */

/** What the warning rules read: current values, unread paths, and whether the tables have landed. */
export interface WarningInput {
  readonly fields: CanonicalPayslipFields;
  /** Both passes' unreadable canonical paths, scalars first. */
  readonly unreadableFields: readonly string[];
  readonly tablesStatus: TablesStatus;
}

/** Paths whose unreadable text is a date; every other unreadable path is a number (Task 06 D5). */
const DATE_FIELDS: readonly string[] = ["period", "paymentDate"];

/**
 * Every warning `input` raises, in `WARNING_CODES` order, and within one code in the order of
 * `CRITICAL_FIELDS` or of `unreadableFields`.
 */
export function computeWarnings(input: WarningInput): PayslipWarning[] {
  const { fields, unreadableFields, tablesStatus } = input;
  // Still null: once a value is typed in, "we could not read this" no longer applies (D5).
  const stillUnreadable = unreadableFields.filter((path) => valueAt(fields, path) == null);

  return [
    // Unreadable supersedes missing, so "not read" and "not on the page" stay distinct (D5).
    ...CRITICAL_FIELDS.filter(
      (field) => fields[field] == null && !unreadableFields.includes(field),
    ).map((field) => warning("missing_critical_field", field)),
    ...stillUnreadable
      .filter((path) => !DATE_FIELDS.includes(path))
      .map((path) => warning("unparseable_amount", path)),
    ...stillUnreadable
      .filter((path) => DATE_FIELDS.includes(path))
      .map((path) => warning("unparseable_date", path)),
    ...(["employerOib", "employeeOib"] as const)
      .filter((field) => {
        const oib = fields[field];
        return oib != null && !isValidOib(oib);
      })
      .map((field) => warning("oib_checksum_failed", field)),
    ...identityWarnings(fields),
    ...payComponentsWarnings(fields, tablesStatus),
  ];
}

/**
 * The four payroll identities. One with a null operand is skipped: the gap already raises
 * `missing_critical_field` or `unparseable_*` where that applies, and a second warning about it
 * would be noise (D2).
 */
function identityWarnings(fields: CanonicalPayslipFields): PayslipWarning[] {
  const warnings: PayslipWarning[] = [];
  const {
    brutoPlaca,
    doprinosiIzPlace,
    dohodak,
    osobniOdbitak,
    poreznaOsnovica,
    porezNaDohodak,
    netoPlaca,
    iznosZaIsplatu,
  } = fields;

  if (brutoPlaca != null && doprinosiIzPlace != null && dohodak != null) {
    if (!amountsAgreeToTheCent(subtractAmounts(brutoPlaca, doprinosiIzPlace), dohodak)) {
      warnings.push(warning("dohodak_mismatch", "dohodak"));
    }
  }

  if (dohodak != null && osobniOdbitak != null && poreznaOsnovica != null) {
    // Floors at zero: an allowance larger than dohodak legitimately prints 0,00 (B01).
    const difference = subtractAmounts(dohodak, osobniOdbitak);
    const expected = compareAmounts(difference, "0") < 0 ? "0" : difference;
    if (!amountsAgreeToTheCent(expected, poreznaOsnovica)) {
      warnings.push(warning("porezna_osnovica_mismatch", "poreznaOsnovica"));
    }
  }

  if (dohodak != null && porezNaDohodak != null && netoPlaca != null) {
    if (!amountsAgreeToTheCent(subtractAmounts(dohodak, porezNaDohodak), netoPlaca)) {
      warnings.push(warning("neto_mismatch", "netoPlaca"));
    }
  }

  if (netoPlaca != null && iznosZaIsplatu != null) {
    // A null total means the section is not on the page, which contributes nothing (the
    // golden-set README; F01 prints no obustave). So this identity still fires, and points at
    // the payout, when OCR drops a printed total (D2).
    const expected = subtractAmounts(
      addAmounts(netoPlaca, fields.neoporeziviPrimiciUkupno ?? "0"),
      fields.obustaveUkupno ?? "0",
    );
    if (!amountsAgreeToTheCent(expected, iznosZaIsplatu)) {
      warnings.push(warning("isplata_mismatch", "iznosZaIsplatu"));
    }
  }

  return warnings;
}

/**
 * `Σ payComponents.iznos` against `brutoPlaca`, over amounts only: hours never sum to the
 * printed total (B02's leaf hours are 266 against 176). Evaluated once the tables pass has
 * landed, and only when at least one row has an amount: with none there is nothing to compare
 * (G01's components are off the page). Rows without an amount are left out of the sum (D2).
 */
function payComponentsWarnings(
  fields: CanonicalPayslipFields,
  tablesStatus: TablesStatus,
): PayslipWarning[] {
  if (tablesStatus !== "ready" || fields.brutoPlaca == null) return [];
  const amounts = (fields.payComponents ?? []).flatMap((row) =>
    row.iznos == null ? [] : [row.iznos],
  );
  if (amounts.length === 0) return [];
  const sum = amounts.reduce((total, amount) => addAmounts(total, amount));
  return amountsAgreeToTheCent(sum, fields.brutoPlaca)
    ? []
    : [warning("pay_components_sum_mismatch", "payComponents")];
}

/**
 * The value at a canonical dotted path (`brutoPlaca`, `payComponents.2.iznos`). A path whose
 * row no longer exists resolves to `undefined`.
 */
function valueAt(fields: CanonicalPayslipFields, path: string): unknown {
  let value: unknown = fields;
  for (const segment of path.split(".")) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function warning(code: PayslipWarning["code"], field: string): PayslipWarning {
  return { code, field };
}
