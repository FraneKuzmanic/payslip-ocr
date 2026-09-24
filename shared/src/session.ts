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
 * The payslip statuses of PRD §6.6, closed. ROADMAP Task 05 extends them with a tables-pending
 * state once one exists.
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
