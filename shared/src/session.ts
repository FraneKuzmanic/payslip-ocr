import { z } from "zod";

/**
 * A Session is the set of Payslips uploaded together. It has **no status of its own**: its
 * progress is read from the Payslips it holds ("3 of 5 confirmed", PRD §6.6).
 */
export const sessionSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;

/**
 * The payslip statuses of PRD §6.6, closed: the user-facing lifecycle that governs editing,
 * confirming and retrying. Whether the line-item tables have landed is a separate question,
 * answered by `TABLES_STATUSES` (Task 05 D6), so no status has a with-tables twin.
 */
export const PAYSLIP_STATUSES = ["processing", "review", "confirmed", "failed"] as const;
export const payslipStatusSchema = z.enum(PAYSLIP_STATUSES);
export type PayslipStatus = z.infer<typeof payslipStatusSchema>;

/**
 * `confirmed` has no outgoing transition. PRD §6.6's back-arrow means "edits are still allowed",
 * and a PATCH never changes status (PRD §10.6), so an edit keeps a payslip confirmed; confirming
 * again is idempotent at the route rather than a transition.
 */
export const PAYSLIP_STATUS_TRANSITIONS: Readonly<Record<PayslipStatus, readonly PayslipStatus[]>> =
  {
    processing: ["review", "failed"],
    review: ["confirmed"],
    confirmed: [],
    failed: ["processing"],
  };

export function canTransition(from: PayslipStatus, to: PayslipStatus): boolean {
  return PAYSLIP_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Whether a payslip's line-item tables have landed (Task 05 D6). Extraction runs in two passes:
 * the scalars pass moves `status` to `review`, and the tables pass moves this to `ready`, in
 * either order. `failed` means the tables pass failed, was cancelled or was reaped; a payslip in
 * `review` with failed tables is usable and distinct from a failed payslip.
 *
 * Confirm is refused while `pending` (Task 09), so export, which requires `confirmed`, waits for
 * both passes to settle.
 */
export const TABLES_STATUSES = ["pending", "ready", "failed"] as const;
export const tablesStatusSchema = z.enum(TABLES_STATUSES);
export type TablesStatus = z.infer<typeof tablesStatusSchema>;

/** The statuses in which the canonical fields may be edited (PRD §7.7, §10.6). */
export const EDITABLE_PAYSLIP_STATUSES = ["review", "confirmed"] as const;

export const EXTRACTION_FAILURE_REASONS = [
  "unreadable_document",
  "provider_rejected",
  "provider_unavailable",
] as const;
export const extractionFailureReasonSchema = z.enum(EXTRACTION_FAILURE_REASONS);
export type ExtractionFailureReason = z.infer<typeof extractionFailureReasonSchema>;

/**
 * Retryability is a function of the reason, never a separate flag (PRD §7.4): an unreadable or
 * rejected document fails the same way again, while an unavailable provider may not.
 */
export const RETRYABLE_FAILURE_REASONS = [
  "provider_unavailable",
] as const satisfies readonly ExtractionFailureReason[];

export function isRetryableFailure(reason: ExtractionFailureReason): boolean {
  return (RETRYABLE_FAILURE_REASONS as readonly ExtractionFailureReason[]).includes(reason);
}
