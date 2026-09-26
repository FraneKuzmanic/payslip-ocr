import {
  canonicalPayslipFieldsSchema,
  neoporeziviPrimitakSchema,
  obustavaSchema,
  payComponentSchema,
  type CanonicalPayslipFields,
} from "@payslip/shared";

/** The three line-item tables, the only array-valued canonical fields. */
export const TABLE_FIELDS = ["payComponents", "obustave", "neoporeziviPrimici"] as const;

export type TableField = (typeof TABLE_FIELDS)[number];

/** Each table's columns, from its row schema, so a new column is covered automatically. */
const TABLE_COLUMNS: Record<TableField, readonly string[]> = {
  payComponents: Object.keys(payComponentSchema.shape),
  obustave: Object.keys(obustavaSchema.shape),
  neoporeziviPrimici: Object.keys(neoporeziviPrimitakSchema.shape),
};

const SCALAR_FIELDS: readonly string[] = Object.keys(canonicalPayslipFieldsSchema.shape).filter(
  (key) => !(TABLE_FIELDS as readonly string[]).includes(key),
);

type Row = Readonly<Record<string, unknown>>;

/**
 * Canonical paths the user changed from the machine extraction (Task 09 D4, D5): scalars in schema
 * order, then table cells as `obustave.2.iznos`. Always computed over the full current state, so
 * typing the original value back clears the mark.
 *
 * Cells compare by position. When a table's length differs, every cell of every current row from
 * the first row that differs is edited: those rows no longer line up with the document, and
 * marking them errs in the honest direction. A table absent from both sides (tables pass not
 * landed) is skipped. `null` original: nothing to compare against, so nothing is edited.
 */
export function editedFields(
  current: CanonicalPayslipFields,
  original: Partial<CanonicalPayslipFields> | null,
): string[] {
  if (original === null) return [];

  const paths = SCALAR_FIELDS.filter((key) => !same(field(current, key), field(original, key)));

  for (const table of TABLE_FIELDS) {
    const now = current[table];
    const was = original[table];
    if (now === undefined && was === undefined) continue;
    paths.push(...editedCells(table, rowsOf(now), rowsOf(was)));
  }
  return paths;
}

/**
 * Drops the machine signals that no longer describe a value on the page (Task 09 D6): every edited
 * path, and every table path whose row no longer exists. Other paths pass unchanged.
 */
export function liveSignals(
  paths: readonly string[],
  edited: readonly string[],
  fields: CanonicalPayslipFields,
): string[] {
  const editedSet = new Set(edited);
  return paths.filter((path) => {
    if (editedSet.has(path)) return false;
    const [table, index] = path.split(".");
    if (!(TABLE_FIELDS as readonly string[]).includes(table ?? "")) return true;
    return Number(index) < rowsOf(fields[table as TableField]).length;
  });
}

function editedCells(table: TableField, now: readonly Row[], was: readonly Row[]): string[] {
  const columns = TABLE_COLUMNS[table];
  const rowsDiffer = (i: number) =>
    columns.some((column) => !same(now[i]?.[column], was[i]?.[column]));

  // Equal lengths compare cell by cell. Otherwise rows from the first difference down no longer
  // line up with the document: the first differing row, or the shorter length if the common
  // prefix is equal.
  let shiftFrom = Infinity;
  if (now.length !== was.length) {
    shiftFrom = Math.min(now.length, was.length);
    for (let i = 0; i < shiftFrom; i++) {
      if (rowsDiffer(i)) {
        shiftFrom = i;
        break;
      }
    }
  }

  return now.flatMap((row, i) =>
    columns
      .filter((column) => i >= shiftFrom || !same(row[column], was[i]?.[column]))
      .map((column) => `${table}.${i}.${column}`),
  );
}

function field(fields: Partial<CanonicalPayslipFields>, key: string): unknown {
  return (fields as Readonly<Record<string, unknown>>)[key];
}

function rowsOf(value: unknown): readonly Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

/**
 * Whitespace runs collapse to one space, so a line break joined into a space (Task 09 D17) is not
 * an edit. `null`, `undefined` and blank are equal. `"100.50"` against `"100.5"` is an edit: the
 * user retyped it.
 */
function same(a: unknown, b: unknown): boolean {
  return normalise(a) === normalise(b);
}

function normalise(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}
