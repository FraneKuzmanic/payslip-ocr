import { z } from "zod";
import {
  sourceRegionsResponseSchema,
  type SourceRegion,
  type SourceRegionsResponse,
} from "@payslip/shared";
import { SCALAR_FIELDS, TABLE_COLUMNS } from "./fields.js";

/**
 * Source regions: a read-time projection over the retained pass bodies (PRD §6.2, §7.5), so no
 * geometry is stored and every payslip already analysed gets regions. Each quad is divided by its
 * own page's width and height, which makes images (pixels) and PDFs (inches) identical to the
 * client. A value printed across several lines has one region per line (Task 08 D3), and every
 * region's origin is `model`, the service's own `source` (D5).
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
  .object({ pageNumber: z.number().int().min(1), width: z.number(), height: z.number() })
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

const EMPTY: SourceRegionsResponse = { pages: [], regions: [] };
const SEGMENT = /^D\((\d+),([^()]*)\)$/;

export function projectSourceRegions(raw: unknown): SourceRegionsResponse {
  const stored = storedSchema.safeParse(raw);
  if (!stored.success) return EMPTY;

  const scalars = parseBody(stored.data.scalars);
  const tables = parseBody(stored.data.tables);
  const regions: SourceRegion[] = [];

  if (scalars !== null) {
    for (const name of SCALAR_FIELDS) {
      addValue(regions, name, scalars.fields[name], scalars.dimensions);
    }
  }
  if (tables !== null) {
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const cells = tables.fields[table]?.valueArray ?? [];
      cells.forEach((row, index) => {
        for (const column of columns) {
          addValue(
            regions,
            `${table}.${index}.${column}`,
            row.valueObject?.[column],
            tables.dimensions,
          );
        }
      });
    }
  }

  // Both passes OCR the same document; the scalars body is the one a readable form always has.
  const dimensions = scalars?.dimensions ?? tables?.dimensions ?? new Map();
  const pages = [...dimensions.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([page, { width, height }]) => ({ page, aspectRatio: width / height }));

  return sourceRegionsResponseSchema.parse({ pages, regions: deduplicate(regions) });
}

/** An unparseable body contributes nothing: a malformed stored row never throws on read. */
function parseBody(
  body: unknown,
): { fields: Record<string, Field>; dimensions: Dimensions } | null {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return null;
  const [content] = parsed.data.result.contents;
  const dimensions = new Map<number, { width: number; height: number }>();
  for (const page of content?.pages ?? []) {
    if (page.width > 0 && page.height > 0) {
      dimensions.set(page.pageNumber, { width: page.width, height: page.height });
    }
  }
  return { fields: content?.fields ?? {}, dimensions };
}

/** The mapper's `read()` condition (`fields.ts`): a non-blank printed value, here with a source (D6). */
function addValue(
  regions: SourceRegion[],
  path: string,
  value: Value | undefined,
  dimensions: Dimensions,
): void {
  if (value?.valueString === undefined || value.valueString.trim() === "") return;
  if (value.source === undefined) return;

  for (const segment of value.source.split(";")) {
    const match = SEGMENT.exec(segment.trim());
    if (match === null) continue;
    const page = Number(match[1]);
    const numbers = (match[2] ?? "").split(",").map(Number);
    const size = dimensions.get(page);
    if (numbers.length !== 8 || !numbers.every(Number.isFinite) || size === undefined) continue;
    const corners = [0, 2, 4, 6].map((i) => ({
      x: clamp((numbers[i] ?? 0) / size.width),
      y: clamp((numbers[i + 1] ?? 0) / size.height),
    }));
    regions.push({ fields: [path], page, corners, origin: "model" });
  }
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
