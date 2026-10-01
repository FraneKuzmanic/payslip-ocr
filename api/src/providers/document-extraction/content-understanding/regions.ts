import { z } from "zod";
import {
  sourceRegionsResponseSchema,
  type SourceRegion,
  type SourceRegionsResponse,
} from "@payslip/shared";
import { TABLE_COLUMNS, scalarPartBodies } from "./fields.js";
import { groundingKey, surfaceForms } from "./grounding.js";
import {
  parseSegment,
  storedRowOrder,
  storedRows,
  storedTotalRow,
  type Segment,
} from "./row-order.js";

/**
 * Source regions: a read-time projection over the retained pass bodies (PRD §6.2, §7.5), so no
 * geometry is stored and every payslip already analysed gets regions. Each quad is divided by its
 * own page's width and height, which makes images (pixels) and PDFs (inches) identical to the
 * client. A value printed across several lines has one region per line (Task 08 D3), and every
 * region's origin is `model`, the service's own `source` (D5). An outline whose words do not show
 * the value is withheld, all its lines together, like a value with no source (Task 16 D6): the
 * service's source sometimes lands on unrelated text.
 *
 * The service applies EXIF orientation and PDF `/Rotate` before reporting page sizes and quads,
 * so both arrive in displayed space (measured, Task 08 D11).
 */

// Narrow views of exactly what is read, in the `fields.ts` style.
const valueSchema = z
  .object({ valueString: z.string().optional(), source: z.string().optional() })
  .loose();

const fieldSchema = valueSchema.extend({
  valueArray: z
    .array(z.object({ valueObject: z.record(z.string(), valueSchema).optional() }).loose())
    .optional(),
});

const pageSchema = z
  .object({
    pageNumber: z.number().int().min(1),
    width: z.number(),
    height: z.number(),
    words: z.array(z.object({ content: z.string(), source: z.string() }).loose()).optional(),
  })
  .loose();

const bodySchema = z
  .object({
    result: z
      .object({
        contents: z
          .array(
            z
              .object({
                pages: z.array(pageSchema).optional(),
                fields: z.record(z.string(), fieldSchema).optional(),
              })
              .loose(),
          )
          .min(1),
      })
      .loose(),
  })
  .loose();

const storedSchema = z
  .object({ scalars: z.unknown().optional(), tables: z.unknown().optional() })
  .loose();

type Value = z.infer<typeof valueSchema>;
type Field = z.infer<typeof fieldSchema>;
type Dimensions = ReadonlyMap<number, { width: number; height: number }>;
/** A word's grounding key and quad centre, in its page's own units. */
type Word = { key: string; x: number; y: number };
type Body = {
  fields: Record<string, Field>;
  dimensions: Dimensions;
  words: ReadonlyMap<number, readonly Word[]>;
};

const EMPTY: SourceRegionsResponse = { pages: [], regions: [] };

/**
 * `extractionMetadata` says which order the payslip's table rows were stored in (Task 17 D13) and
 * which pay-component row was left out (D14), so a cell's path names the same row here as in the
 * stored fields.
 */
export function projectSourceRegions(
  raw: unknown,
  extractionMetadata?: unknown,
): SourceRegionsResponse {
  const stored = storedSchema.safeParse(raw);
  if (!stored.success) return EMPTY;

  const tables = parseBody(stored.data.tables);
  const regions: SourceRegion[] = [];

  // One body before Task 17, two parts since: each scalar comes from the body that owns it
  // (Task 17 D9).
  let scalarDimensions: Dimensions | undefined;
  for (const part of scalarPartBodies(stored.data.scalars) ?? []) {
    const body = parseBody(part.body);
    if (body === null) continue;
    scalarDimensions ??= body.dimensions;
    for (const name of part.fields) {
      addValue(regions, name, body.fields[name], body);
    }
  }
  if (tables !== null) {
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const cells = storedRows(
        table,
        tables.fields[table]?.valueArray ?? [],
        storedRowOrder(extractionMetadata),
        storedTotalRow(extractionMetadata),
      );
      cells.forEach((row, index) => {
        for (const column of columns) {
          addValue(regions, `${table}.${index}.${column}`, row.valueObject?.[column], tables);
        }
      });
    }
  }

  // Every analysis OCRs the same document; a scalars body is the one a readable form always has.
  const dimensions = scalarDimensions ?? tables?.dimensions ?? new Map();
  const pages = [...dimensions.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([page, { width, height }]) => ({ page, aspectRatio: width / height }));

  return sourceRegionsResponseSchema.parse({ pages, regions: deduplicate(regions) });
}

/**
 * An unparseable body contributes nothing: a malformed stored row never throws on read. Each body
 * keeps its own pages' words, as each pass is grounded against its own (Task 06 D8).
 */
function parseBody(body: unknown): Body | null {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return null;
  const [content] = parsed.data.result.contents;
  const dimensions = new Map<number, { width: number; height: number }>();
  const words = new Map<number, Word[]>();
  for (const page of content?.pages ?? []) {
    if (page.width > 0 && page.height > 0) {
      dimensions.set(page.pageNumber, { width: page.width, height: page.height });
    }
    if (page.words !== undefined) {
      words.set(
        page.pageNumber,
        page.words.flatMap(({ content: text, source }) => {
          const quad = parseSegment(source);
          if (quad === null) return [];
          const { xs, ys } = axes(quad);
          return [{ key: groundingKey(text), x: mean(xs), y: mean(ys) }];
        }),
      );
    }
  }
  return { fields: content?.fields ?? {}, dimensions, words };
}

function axes({ numbers }: Segment): { xs: number[]; ys: number[] } {
  return {
    xs: [0, 2, 4, 6].map((i) => numbers[i] ?? 0),
    ys: [1, 3, 5, 7].map((i) => numbers[i] ?? 0),
  };
}

/**
 * The mapper's `read()` condition (`fields.ts`): a non-blank printed value, here with a source
 * (D6), whose words agree with it (Task 16 D6).
 */
function addValue(
  regions: SourceRegion[],
  path: string,
  value: Value | undefined,
  { dimensions, words }: Body,
): void {
  if (value?.valueString === undefined || value.valueString.trim() === "") return;
  if (value.source === undefined) return;

  const segments = value.source
    .split(";")
    .map(parseSegment)
    .filter((segment): segment is Segment => segment !== null && dimensions.has(segment.page));

  // A page without words cannot say anything, so its outline is drawn as before (Task 16 D6).
  if (segments.every(({ page }) => words.has(page))) {
    const under = segments.flatMap((segment) => {
      const { xs, ys } = axes(segment);
      const [left, right] = [Math.min(...xs), Math.max(...xs)];
      const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
      return (words.get(segment.page) ?? [])
        .filter(({ x, y }) => x >= left && x <= right && y >= top && y <= bottom)
        .map(({ key }) => key);
    });
    if (!agrees(value.valueString, under)) return;
  }

  for (const segment of segments) {
    const size = dimensions.get(segment.page)!;
    const { xs, ys } = axes(segment);
    const corners = xs.map((x, i) => ({
      x: clamp(x / size.width),
      y: clamp((ys[i] ?? 0) / size.height),
    }));
    regions.push({ fields: [path], page: segment.page, corners, origin: "model" });
  }
}

/**
 * Whether the words under a value's outline show it (Task 16 D6): the printed value, or a form it
 * may be printed as, is a substring of those words run together, or each of its whitespace tokens
 * is one of them (a wrapped or reordered value). `surfaceForms` is given the returned string: for
 * an OIB without its `HR`, and a date the schema asked for as `YYYY-MM-DD` before Task 16, that
 * string is already canonical. Unlike `isGrounded`, which searches the whole page for runs of
 * whole words, this looks only under the outline. A word is under an outline when its centre lies in
 * the segment's axis-aligned box, so a word straddling the edge counts by its centre.
 */
function agrees(printed: string, keys: readonly string[]): boolean {
  const run = keys.join("");
  const present = new Set(keys);
  return [printed, ...surfaceForms(printed)].some((form) => {
    const key = groundingKey(form);
    if (key === "") return false;
    if (run.includes(key)) return true;
    return form
      .split(/\s+/)
      .map(groundingKey)
      .filter((token) => token !== "")
      .every((token) => present.has(token));
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Identical quads merge into one region carrying every field, so the overlay draws one outline
 * and its click goes to the first field (ported from receipt-ocr's `deduplicate`).
 */
function deduplicate(regions: readonly SourceRegion[]): SourceRegion[] {
  const byKey = new Map<string, SourceRegion>();
  for (const region of regions) {
    const key = `${region.page}:${region.corners.map(({ x, y }) => `${x.toFixed(5)},${y.toFixed(5)}`).join(";")}`;
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, { ...region, fields: [...region.fields] });
    else existing.fields.push(...region.fields.filter((field) => !existing.fields.includes(field)));
  }
  return [...byKey.values()];
}
