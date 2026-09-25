/**
 * Confidence below which an extracted value is marked for attention. Measured 2026-09-25 over
 * five recorded sets (Task 06 D7): 0.5 flags ~5% of scalars and catches 6 of 7 wrong ones,
 * every wrong value 0.7 catches at half the flags. One global value, because per-field
 * thresholds tuned on eleven documents would be fitting noise.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** One extraction pass's per-path confidences, as its metadata stores them. */
export interface PassFieldConfidence {
  readonly fields: Readonly<Record<string, { readonly confidence: number | null }>>;
}

/**
 * Canonical paths whose confidence is below `LOW_CONFIDENCE_THRESHOLD`, unique, in pass order
 * (scalars first, as the caller passes them). A `null` confidence is unknown, not low. The mark
 * never suppresses the value.
 */
export function lowConfidenceFields(passes: readonly PassFieldConfidence[]): string[] {
  const paths = passes.flatMap((pass) =>
    Object.entries(pass.fields).flatMap(([path, { confidence }]) =>
      confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD ? [path] : [],
    ),
  );
  return [...new Set(paths)];
}
