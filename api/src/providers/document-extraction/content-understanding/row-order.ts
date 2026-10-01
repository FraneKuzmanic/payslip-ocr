import { z } from "zod";

/**
 * Table rows in the order they are printed (Task 17 D13). The service returns a table's rows in an
 * order that varies between runs of one document: A01's obustave came back reordered in four of
 * eight recorded sets, and asking for printed order in the field description (Task 16 D2) did not
 * stop it. Each cell's own `source` says where it is printed, so the order is read from there.
 *
 * A payslip's stored rows, its field paths and its outlines must all use one order. Rows are in
 * printed order from Task 17 on, and the tables pass's metadata says so (`rowOrder`); a payslip
 * stored before keeps the order the service returned, so its outlines stay on its rows.
 */
export type RowOrder = "printed" | "returned";

export interface Segment {
  page: number;
  numbers: number[];
}

const SEGMENT = /^D\((\d+),([^()]*)\)$/;

/** A `D(page,x1,y1,…,x4,y4)` segment, or `null` when it is not one. */
export function parseSegment(segment: string): Segment | null {
  const match = SEGMENT.exec(segment.trim());
  if (match === null) return null;
  const numbers = (match[2] ?? "").split(",").map(Number);
  if (numbers.length !== 8 || !numbers.every(Number.isFinite)) return null;
  return { page: Number(match[1]), numbers };
}

interface SourcedRow {
  valueObject?: Record<string, { source?: string | undefined }> | undefined;
}

type Place = { page: number; y: number };

const byPlace = (a: Place, b: Place) => a.page - b.page || a.y - b.y;

/**
 * Where a row is printed: the middle one of its cells' places, each cell placed by the first line
 * of its value. The middle, so a single cell whose source sits on other text (A01's creditors,
 * Task 16 D6) cannot move a row of three or more sourced cells. Two cells have no middle: the
 * upper one places the row, so a stray source above it would move it. None of the 192 recorded
 * two-cell rows has one (history/17, review). `null` when no cell has a source.
 */
function placeOf(row: SourcedRow): Place | null {
  const places = Object.values(row.valueObject ?? {})
    .flatMap((cell) => {
      const first = (cell.source ?? "").split(";").map(parseSegment).find(Boolean);
      if (!first) return [];
      const ys = [1, 3, 5, 7].map((index) => first.numbers[index] ?? 0);
      return [{ page: first.page, y: ys.reduce((sum, y) => sum + y, 0) / ys.length }];
    })
    .toSorted(byPlace);
  return places[Math.floor((places.length - 1) / 2)] ?? null;
}

/**
 * `rows` top to bottom, a page at a time. Rows at the same height keep the order returned, and a
 * row that cannot be placed keeps its position in the list.
 */
export function inPrintedOrder<Row extends SourcedRow>(rows: readonly Row[]): Row[] {
  const entries = rows.map((row, index) => ({ row, index, place: placeOf(row) }));
  const placed = entries
    .filter((entry): entry is { row: Row; index: number; place: Place } => entry.place !== null)
    .toSorted((a, b) => byPlace(a.place, b.place) || a.index - b.index);
  let next = 0;
  return entries.map(({ row, place }) => (place === null ? row : (placed[next++]?.row ?? row)));
}

/**
 * A table's rows as a payslip stores them: the pay components without their total row when one
 * was left out (Task 17 D14, `totalRow` is its index as returned), then in the payslip's row order.
 * The mapper and the regions projection both number rows from this, so a path names one row.
 */
export function storedRows<Row extends SourcedRow>(
  table: string,
  returned: readonly Row[],
  rowOrder: RowOrder,
  totalRow: number | null,
): readonly Row[] {
  const kept =
    table === "payComponents" && totalRow !== null
      ? returned.filter((_, index) => index !== totalRow)
      : returned;
  return rowOrder === "printed" ? inPrintedOrder(kept) : kept;
}

const printedSchema = z
  .object({ tables: z.object({ rowOrder: z.literal("printed") }).loose() })
  .loose();

/** The order a stored payslip's table rows are in, from its extraction metadata. */
export function storedRowOrder(extractionMetadata: unknown): RowOrder {
  return printedSchema.safeParse(extractionMetadata).success ? "printed" : "returned";
}

const totalRowSchema = z
  .object({ tables: z.object({ totalRow: z.int().nonnegative() }).loose() })
  .loose();

/**
 * The pay-component row a stored payslip's tables pass left out, as an index into the returned
 * rows, from its extraction metadata (Task 17 D14). `null` when it left none out.
 */
export function storedTotalRow(extractionMetadata: unknown): number | null {
  const stored = totalRowSchema.safeParse(extractionMetadata);
  return stored.success ? stored.data.tables.totalRow : null;
}
