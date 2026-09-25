import { z } from "zod";

/**
 * The warning taxonomy — codes only, so the model, the API and the UI agree on the vocabulary.
 * The nine codes are exactly PRD §7.9's, in its order. The rules live in
 * `api/src/validation/warnings.ts`, and warnings are computed on every read, never stored
 * (Task 06 D1).
 *
 * Warnings never block confirmation or export (PRD §7.9). The client owns the copy, which is
 * added by the task that first renders a warning.
 */
export const WARNING_CODES = [
  "missing_critical_field",
  "unparseable_amount",
  "unparseable_date",
  "oib_checksum_failed",
  "dohodak_mismatch",
  "porezna_osnovica_mismatch",
  "neto_mismatch",
  "isplata_mismatch",
  "pay_components_sum_mismatch",
] as const;

export const warningCodeSchema = z.enum(WARNING_CODES);
export type WarningCode = z.infer<typeof warningCodeSchema>;

/**
 * A warning carries a stable machine code and the field it concerns, never prose: the client
 * translates the code, exactly as it does for error codes (PRD §7.13). `field` is a canonical
 * dotted path such as `netoPlaca` or `payComponents.2.iznos`, so the review form can attach the
 * message to the right input.
 */
export const payslipWarningSchema = z
  .object({
    code: warningCodeSchema,
    field: z.string().nullable().optional(),
  })
  .strict();

export type PayslipWarning = z.infer<typeof payslipWarningSchema>;
