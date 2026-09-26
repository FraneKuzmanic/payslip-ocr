import {
  parseAmount,
  parseDate,
  parsePeriod,
  parseQuantity,
  type CanonicalPayslipFields,
  type NeoporeziviPrimitak,
  type Obustava,
  type PayComponent,
  type UpdatePayslipRequest,
} from "@payslip/shared";
import type { Path, PathValue } from "react-hook-form";
import type { ScalarField, TableField } from "./regionSections";

export type FieldKind = "text" | "amount" | "quantity" | "date" | "period";
export type FormLanguage = "hr" | "en";

/** How each scalar is shown and parsed (Task 09 D12). Typed over the canonical scalars. */
export const SCALAR_KINDS: Record<ScalarField, FieldKind> = {
  employerName: "text",
  employerAddress: "text",
  employerOib: "text",
  employerIban: "text",
  employeeName: "text",
  employeeAddress: "text",
  employeeOib: "text",
  employeeIban: "text",
  period: "period",
  paymentDate: "date",
  ukupnoSati: "quantity",
  brutoPlaca: "amount",
  doprinosiIzPlace: "amount",
  doprinosMioIStup: "amount",
  doprinosMioIiStup: "amount",
  dohodak: "amount",
  osobniOdbitak: "amount",
  poreznaOsnovica: "amount",
  porezNaDohodak: "amount",
  netoPlaca: "amount",
  neoporeziviPrimiciUkupno: "amount",
  obustaveUkupno: "amount",
  iznosZaIsplatu: "amount",
  doprinosiNaPlacu: "amount",
  ukupanTrosakRada: "amount",
};

/** Each table's columns in display order, with their kinds. Typed over the row schemas. */
export const COLUMN_KINDS = {
  payComponents: { naziv: "text", sati: "quantity", koeficijent: "quantity", iznos: "amount" },
  obustave: {
    naziv: "text",
    vjerovnik: "text",
    iznos: "amount",
    ostatakSalda: "amount",
    brojRata: "text",
  },
  neoporeziviPrimici: { naziv: "text", iznos: "amount" },
} as const satisfies {
  payComponents: Record<keyof PayComponent, FieldKind>;
  obustave: Record<keyof Obustava, FieldKind>;
  neoporeziviPrimici: Record<keyof NeoporeziviPrimitak, FieldKind>;
};

export const TABLE_FIELDS = ["payComponents", "obustave", "neoporeziviPrimici"] as const;

export type ColumnOf<T extends TableField> = keyof (typeof COLUMN_KINDS)[T] & string;
export type RowValues<T extends TableField> = Record<ColumnOf<T>, string>;

/** Every input holds text; values are parsed only on save (D12). */
export type ReviewFormValues = Record<ScalarField, string> & {
  [T in TableField]: RowValues<T>[];
};

/** Every form path that holds one input's text: scalars and table cells, never a whole table. */
export type InputPath = {
  [P in Path<ReviewFormValues>]: PathValue<ReviewFormValues, P> extends string ? P : never;
}[Path<ReviewFormValues>];

export type ReviewErrorKey =
  "review.errors.amount" | "review.errors.quantity" | "review.errors.date" | "review.errors.period";

const SCALAR_NAMES = Object.keys(SCALAR_KINDS) as ScalarField[];

export function columnsOf<T extends TableField>(table: T): ColumnOf<T>[] {
  return Object.keys(COLUMN_KINDS[table]) as ColumnOf<T>[];
}

export function columnKind<T extends TableField>(table: T, column: ColumnOf<T>): FieldKind {
  return (COLUMN_KINDS[table] as Record<string, FieldKind>)[column] ?? "text";
}

/**
 * A stored value as the input shows it in `language` (D12). Decimals swap only the separator and
 * keep their digits and scale: no grouping, because `1.234` would fail `parseAmount`'s ambiguity
 * rule on the next save. Text joins line breaks into spaces, which a single-line input would
 * otherwise drop (D17).
 */
export function formatField(
  kind: FieldKind,
  value: string | null | undefined,
  language: FormLanguage,
) {
  if (value === null || value === undefined) return "";
  if (kind === "text") return value.replaceAll(/\s*\n\s*/gu, " ");
  if (language === "en") return value;
  if (kind === "amount" || kind === "quantity") return value.replace(".", ",");
  if (kind === "date") {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}

export type ParsedField = { ok: true; value: string | null } | { ok: false };

/**
 * An input's text as a canonical value. Blank is `null`; text is trimmed. The shared parsers
 * accept both locales' forms, so switching language mid-edit is harmless.
 */
export function parseField(kind: FieldKind, raw: string): ParsedField {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  const value =
    kind === "text"
      ? text
      : kind === "amount"
        ? parseAmount(text)
        : kind === "quantity"
          ? parseQuantity(text)
          : kind === "date"
            ? parseDate(text)
            : parsePeriod(text);
  return value === null ? { ok: false } : { ok: true, value };
}

const ERROR_KEYS: Record<Exclude<FieldKind, "text">, ReviewErrorKey> = {
  amount: "review.errors.amount",
  quantity: "review.errors.quantity",
  date: "review.errors.date",
  period: "review.errors.period",
};

/** A react-hook-form `validate` for one kind: true, or the error's translation key. */
export function validatorFor(kind: FieldKind) {
  return (value: string): true | ReviewErrorKey =>
    kind === "text" || parseField(kind, value).ok ? true : ERROR_KEYS[kind];
}

export function toFormValues(
  fields: CanonicalPayslipFields,
  language: FormLanguage,
): ReviewFormValues {
  const scalars = Object.fromEntries(
    SCALAR_NAMES.map((name) => [name, formatField(SCALAR_KINDS[name], fields[name], language)]),
  ) as Record<ScalarField, string>;
  const table = <T extends TableField>(name: T): RowValues<T>[] =>
    ((fields[name] ?? []) as readonly Readonly<Record<string, string | null | undefined>>[]).map(
      (row) =>
        Object.fromEntries(
          columnsOf(name).map((column) => [
            column,
            formatField(columnKind(name, column), row[column], language),
          ]),
        ) as RowValues<T>,
    );
  return {
    ...scalars,
    payComponents: table("payComponents"),
    obustave: table("obustave"),
    neoporeziviPrimici: table("neoporeziviPrimici"),
  };
}

/** The shape of react-hook-form's `dirtyFields`: `true` leaves, nested as the values are. */
export type DirtyMap = Readonly<Record<string, unknown>>;

/**
 * The PATCH body (D17): only the dirty scalars, so an untouched value keeps its stored line
 * breaks. A table is sent whole when any of its rows changed or its row count did, and only when
 * its tables may be edited (D10). Fully blank rows are dropped; an empty table is `[]`. Values are
 * assumed valid: the form's validators ran first.
 */
export function toPatch(
  values: ReviewFormValues,
  dirty: DirtyMap,
  tablesEditable: boolean,
): UpdatePayslipRequest {
  const patch: Record<string, unknown> = {};
  for (const name of SCALAR_NAMES) {
    if (dirty[name] === true) patch[name] = parsed(SCALAR_KINDS[name], values[name]);
  }
  if (tablesEditable) {
    for (const table of TABLE_FIELDS) {
      if (!anyDirty(dirty[table])) continue;
      const rows = values[table] as readonly Readonly<Record<string, string>>[];
      patch[table] = rows
        .filter((row) => Object.values(row).some((cell) => cell.trim() !== ""))
        .map((row) =>
          Object.fromEntries(
            columnsOf(table).map((column) => [
              column,
              parsed(columnKind(table, column), row[column] ?? ""),
            ]),
          ),
        );
    }
  }
  return patch as UpdatePayslipRequest;
}

function parsed(kind: FieldKind, raw: string): string | null {
  const result = parseField(kind, raw);
  return result.ok ? result.value : null;
}

function anyDirty(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(anyDirty);
  if (typeof value === "object" && value !== null) return Object.values(value).some(anyDirty);
  return false;
}
