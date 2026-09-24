import { z } from "zod";
import { sourceContentTypeSchema } from "./upload.js";

/**
 * Response bodies are parsed leniently; request bodies are not.
 *
 * `.strict()` is load-bearing on the **request** side — the `PATCH` body derives from
 * the strict canonical field schema, which is what makes a forged `userId` a schema rejection rather
 * than something every route has to remember to ignore (PRD §9.1) — and inside the API, where it
 * catches database drift and stops provider vocabulary leaking out of a projection. None of that
 * changes.
 *
 * Applied to a **response** the browser reads, the same strictness is actively harmful. A tab left
 * open across a deploy is still running the previous bundle, so a field the API has since added is
 * an ordinary additive change; rejecting the whole body over one unknown key turns every deploy
 * into an outage for everyone mid-session.
 *
 * That is not hypothetical. Shipping `failureReason` on 2026-08-26 did exactly this: every open tab
 * rejected every response, and because the rejection surfaced as the generic processing error
 * screen it looked like an extraction bug on documents that had extracted perfectly. See the
 * sibling prototype's `.agents/history/19-stale-bundle-response-contract.md`.
 *
 * So every response body the client parses is `.strip()`: an unknown key is accepted and then
 * discarded, so a newer API cannot break an older bundle and cannot smuggle an undeclared field
 * into it either. `.loose()` would also accept the key but would carry it through, which is why
 * `.strip()` is the right one here. It relaxes only the level it is applied to, which is where
 * additive fields actually land.
 */
export const apiErrorResponseSchema = z
  .object({
    error: z.object({ code: z.string() }).strip(),
  })
  .strip();

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const EXTRACTION_FAILURE_REASONS = [
  "unreadable_document",
  "provider_rejected",
  "provider_unavailable",
] as const;
export const extractionFailureReasonSchema = z.enum(EXTRACTION_FAILURE_REASONS);
export type ExtractionFailureReason = z.infer<typeof extractionFailureReasonSchema>;

/** PRD §10.9 — `GET /api/payslips/:id/source` */
export const sourceDocumentResponseSchema = z
  .object({
    url: z.url(),
    contentType: sourceContentTypeSchema,
    originalFilename: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .strip();

export type SourceDocumentResponse = z.infer<typeof sourceDocumentResponseSchema>;

/** Where on the source document a canonical value was read from. */
export const sourceRegionSchema = z
  .object({
    fields: z.array(z.string()).min(1),
    page: z.number().int().min(1),
    corners: z.array(z.object({ x: z.number(), y: z.number() }).strict()).length(4),
    origin: z.enum(["model", "text"]),
  })
  .strict();

export type SourceRegion = z.infer<typeof sourceRegionSchema>;

export const sourceRegionsResponseSchema = z
  .object({
    pages: z.array(
      z.object({ page: z.number().int().min(1), aspectRatio: z.number().positive() }).strict(),
    ),
    regions: z.array(sourceRegionSchema),
  })
  .strict();

export type SourceRegionsResponse = z.infer<typeof sourceRegionsResponseSchema>;
