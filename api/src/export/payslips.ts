/**
 * PRD §7.11 — JSON and CSV export of confirmed payslips.
 *
 * JSON is the machine format: full fidelity, canonical decimal strings, all three line-item tables.
 *
 * The CSV exists for Excel and is written in the **Croatian Excel dialect** (plan 12 D1): `;`
 * between fields, a decimal comma in numeric columns, a UTF-8 BOM and CRLF rows. Windows Excel splits
 * a double-clicked CSV by the OS list separator, which is `;` under hr-HR, and a dot decimal there
 * can turn hours such as `8.5` into a date. A `sep=;` hint line would make it work in every locale,
 * but it makes Excel ignore the BOM and mangle `č ć ž š đ`, so it is not written. In an en-US Excel
 * a double-clicked file splits at every comma, decimal commas included (history/12 step 13);
 * Data → From Text/CSV reads it correctly.
 *
 * Known Excel limitation: an all-digit OIB with a leading zero loses the zero when Excel types the
 * cell as a number. The JSON is lossless, and the import wizard can type the column as Text.
 */
import {
  EXPORT_SCHEMA_VERSION,
  canonicalPayslipFieldsSchema,
  exportedPayslipSchema,
  jsonExportResponseSchema,
  type ExportedPayslip,
  type JsonExportResponse,
  type Payslip,
} from "@payslip/shared";

const UTF8_BOM = "\uFEFF";
const CSV_LINE_BREAK = "\r\n";
const CSV_SEPARATOR = ";";

/** Plan 12 D2: structure, the 25 canonical scalars in schema order, then timestamps. */
export const CSV_COLUMNS = [
  "id",
  "sessionId",
  "status",
  "tablesStatus",
  "currency",
  "pageCount",
  "employerName",
  "employerAddress",
  "employerOib",
  "employerIban",
  "employeeName",
  "employeeAddress",
  "employeeOib",
  "employeeIban",
  "period",
  "paymentDate",
  "ukupnoSati",
  "brutoPlaca",
  "doprinosiIzPlace",
  "doprinosMioIStup",
  "doprinosMioIiStup",
  "dohodak",
  "osobniOdbitak",
  "poreznaOsnovica",
  "porezNaDohodak",
  "netoPlaca",
  "neoporeziviPrimiciUkupno",
  "obustaveUkupno",
  "iznosZaIsplatu",
  "doprinosiNaPlacu",
  "ukupanTrosakRada",
  "confirmedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Payslip)[];

type CsvColumn = (typeof CSV_COLUMNS)[number];

const TABLE_FIELDS: ReadonlySet<string> = new Set([
  "payComponents",
  "obustave",
  "neoporeziviPrimici",
]);

/** Every canonical scalar, in schema order. */
export const SCALAR_COLUMNS: readonly string[] = Object.keys(
  canonicalPayslipFieldsSchema.shape,
).filter((key) => !TABLE_FIELDS.has(key));

/** Free text a user or a document controls: formula-neutralised. */
export const TEXT_COLUMNS: ReadonlySet<string> = new Set([
  "employerName",
  "employerAddress",
  "employerOib",
  "employerIban",
  "employeeName",
  "employeeAddress",
  "employeeOib",
  "employeeIban",
]);

/** ISO dates, written as stored. */
export const ISO_COLUMNS: ReadonlySet<string> = new Set(["period", "paymentDate"]);

/** Every other scalar is a decimal string: money or hours, written with a decimal comma. */
export const DECIMAL_COLUMNS: ReadonlySet<string> = new Set(
  SCALAR_COLUMNS.filter((key) => !TEXT_COLUMNS.has(key) && !ISO_COLUMNS.has(key)),
);

const FORMULA_STARTS = new Set(["=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"]);

export function toJsonExport(payslips: Payslip[]): JsonExportResponse {
  return jsonExportResponseSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    payslips: payslips.map(toExportedPayslip),
  });
}

export function toCsv(payslips: Payslip[]): string {
  const rows = [
    CSV_COLUMNS.join(CSV_SEPARATOR),
    ...payslips.map((payslip) =>
      CSV_COLUMNS.map((column) => escapeCsvField(csvValue(payslip, column))).join(CSV_SEPARATOR),
    ),
  ];

  return `${UTF8_BOM}${rows.join(CSV_LINE_BREAK)}`;
}

function toExportedPayslip(payslip: Payslip): ExportedPayslip {
  const copy: Record<string, unknown> = { ...payslip };
  delete copy["userId"];
  delete copy["deletedAt"];
  return exportedPayslipSchema.parse(copy);
}

function csvValue(payslip: Payslip, column: CsvColumn): string {
  const value = payslip[column];
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  if (TEXT_COLUMNS.has(column)) return neutralizeFormula(value);
  // A decimal string has at most one dot (`AMOUNT_PATTERN`), so replacing the first is exact.
  if (DECIMAL_COLUMNS.has(column)) return value.replace(".", ",");
  return value;
}

function neutralizeFormula(value: string): string {
  const first = value.at(0);
  return first !== undefined && FORMULA_STARTS.has(first) ? `'${value}` : value;
}

function escapeCsvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
