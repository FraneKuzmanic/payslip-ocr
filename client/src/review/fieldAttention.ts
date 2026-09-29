import type { PayslipWarning, WarningCode } from "@payslip/shared";

export interface AttentionSignals {
  readonly warnings: readonly PayslipWarning[];
  readonly lowConfidenceFields: readonly string[];
  readonly ungroundableFields: readonly string[];
}

export type Attention =
  | { kind: "warning"; codes: WarningCode[] }
  | { kind: "ungroundable" }
  | { kind: "lowConfidence" }
  | null;

/**
 * The one attention note a path gets (Task 09 D18), in priority order: its warnings, else
 * ungroundable, else low confidence. Every kind looks the same, and never two at once. Attention
 * marks a value; it is never a validation failure, so it never sets `aria-invalid`.
 */
export function attentionFor(path: string, signals: AttentionSignals): Attention {
  const codes = signals.warnings
    .filter((warning) => warning.field === path)
    .map((warning) => warning.code);
  if (codes.length > 0) return { kind: "warning", codes };
  if (signals.ungroundableFields.includes(path)) return { kind: "ungroundable" };
  if (signals.lowConfidenceFields.includes(path)) return { kind: "lowConfidence" };
  return null;
}

/**
 * How many things in a section ask to be checked (Task 15 D9): its paths with an attention note,
 * plus any warnings about the section as a whole. Shown on the section's header, so a collapsed
 * section still says it needs a look.
 */
export function attentionCount(
  paths: readonly string[],
  signals: AttentionSignals,
  warnings: readonly unknown[] = [],
): number {
  return paths.filter((path) => attentionFor(path, signals) !== null).length + warnings.length;
}

/**
 * Warnings about a table as a whole, such as `pay_components_sum_mismatch` on `payComponents`.
 * No cell's lookup can match them, so they render under the table's legend.
 */
export function sectionWarnings(table: string, warnings: readonly PayslipWarning[]): WarningCode[] {
  return warnings.filter((warning) => warning.field === table).map((warning) => warning.code);
}
