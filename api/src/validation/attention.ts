/**
 * Confidence below which an extracted value is marked for attention. Measured 2026-09-25 over
 * five recorded sets (Task 06 D7): 0.5 flags ~5% of scalars and catches 6 of 7 wrong ones,
 * every wrong value 0.7 catches at half the flags. One global value, because per-field
 * thresholds tuned on eleven documents would be fitting noise.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Paths whose low confidence counts only when the same pass also could not ground them (Task 09
 * D7, a per-field rule the product owner chose knowingly). The service reports `period` and
 * `paymentDate` below 0.5 on most payslips even when they are right: 49 of the 68 scalar flags
 * measured in Task 06. The only wrong `period` in any recording (`production` B01) is already
 * marked by `unparseable_date`. `period` is ungroundable by design and so never in
 * `ungroundableFields`, which means it is never marked for confidence alone.
 */
export const GROUNDING_GATED_FIELDS: readonly string[] = ["period", "paymentDate"];

/** One extraction pass's per-path confidences and ungroundable paths, as its metadata stores them. */
export interface PassFieldConfidence {
  readonly fields: Readonly<Record<string, { readonly confidence: number | null }>>;
  readonly ungroundableFields: readonly string[];
}

/**
 * Canonical paths whose confidence is below `LOW_CONFIDENCE_THRESHOLD`, unique, in pass order
 * (scalars first, as the caller passes them). A `null` confidence is unknown, not low. The mark
 * never suppresses the value.
 */
export function lowConfidenceFields(passes: readonly PassFieldConfidence[]): string[] {
  const paths = passes.flatMap((pass) =>
    Object.entries(pass.fields).flatMap(([path, { confidence }]) =>
      confidence !== null &&
      confidence < LOW_CONFIDENCE_THRESHOLD &&
      (!GROUNDING_GATED_FIELDS.includes(path) || pass.ungroundableFields.includes(path))
        ? [path]
        : [],
    ),
  );
  return [...new Set(paths)];
}
