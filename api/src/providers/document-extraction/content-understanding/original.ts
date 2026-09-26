import { z } from "zod";
import type { CanonicalPayslipFields } from "@payslip/shared";
import { mapAnalyzeResult } from "./fields.js";

const storedSchema = z
  .object({ scalars: z.unknown().optional(), tables: z.unknown().optional() })
  .loose();

/**
 * The machine extraction as it was stored, re-mapped from the retained pass bodies (Task 09 D4):
 * the reference a PATCH measures "edited" against. Each body goes through the mapper for its own
 * pass, exactly as the extraction runner stored it, and the passes' keys are disjoint, so their
 * merge order does not matter. `null` when neither body maps.
 *
 * The comparison is against today's mapper. A later mapper change that maps an old body
 * differently would mark those values edited on the payslip's next save.
 */
export function originalExtraction(raw: unknown): Partial<CanonicalPayslipFields> | null {
  const stored = storedSchema.safeParse(raw);
  if (!stored.success) return null;

  const scalars = mapAnalyzeResult(stored.data.scalars, "scalars");
  const tables = mapAnalyzeResult(stored.data.tables, "tables");
  if (scalars === null && tables === null) return null;
  return { ...scalars?.fields, ...tables?.fields };
}
