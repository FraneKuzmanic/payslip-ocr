import { z } from "zod";
import { canonicalPayslipFieldsSchema, payslipSchema } from "./payslip.js";
import { extractionFailureReasonSchema, payslipStatusSchema, sessionSchema } from "./session.js";
import { sourceContentTypeSchema } from "./upload.js";

/**
 * Response bodies are parsed leniently; request bodies are not.
 *
 * `.strict()` is load-bearing on the **request** side — `updatePayslipRequestSchema` derives
 * from the strict canonical field schema, which is what makes a forged `userId` a schema rejection rather
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

/** PRD §10.2 — `POST /api/sessions` */
export const createSessionResponseSchema = sessionSchema
  .pick({ id: true, createdAt: true })
  .strip();

export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

/**
 * PRD §10.3 — `POST /api/sessions/:id/payslips`
 *
 * The request is `multipart/form-data` with exactly one `file` part, so it has no zod schema;
 * `upload/multipart.ts` in the API enforces its shape.
 */
export const createPayslipResponseSchema = payslipSchema
  .pick({ id: true, sessionId: true, status: true, createdAt: true })
  .strip();

export type CreatePayslipResponse = z.infer<typeof createPayslipResponseSchema>;

/** PRD §10.4 — one payslip as a session lists it. */
export const payslipSummarySchema = payslipSchema
  .pick({ id: true, status: true, period: true, employeeName: true, pageCount: true })
  // Canonical fields are optional; §10.4 prints these two on every item, null when unread.
  .required({ period: true, employeeName: true })
  .extend({
    failureReason: extractionFailureReasonSchema.nullable(),
    warningCount: z.number().int().min(0),
  })
  .strip();

export type PayslipSummary = z.infer<typeof payslipSummarySchema>;

/** PRD §10.4 — `GET /api/sessions/:id` */
export const sessionDetailResponseSchema = sessionSchema
  .pick({ id: true, createdAt: true })
  .extend({ payslips: z.array(payslipSummarySchema) })
  .strip();

export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;

/**
 * PRD §10.5 — `GET /api/payslips/:id`
 *
 * The review surface exposes canonical field paths, never provider metadata.
 */
export const payslipDetailResponseSchema = payslipSchema
  .extend({
    lowConfidenceFields: z.array(z.string()),
    unreadableFields: z.array(z.string()),
    /**
     * Scalar canonical fields whose current value differs from the original machine extraction,
     * so the review UI can mark an outline as "this was corrected" rather than implying it still
     * matches the document. Never includes the line-item tables: row indices shift when the user
     * adds or removes a row, which would make a per-index comparison misleading.
     */
    editedFields: z.array(z.string()),
    failureReason: extractionFailureReasonSchema.nullable().optional(),
  })
  .strip();

export type PayslipDetailResponse = z.infer<typeof payslipDetailResponseSchema>;

/**
 * PRD §10.6 — `PATCH /api/payslips/:id`
 *
 * Derived from the tier-1 field schema, so it accepts only what the user may edit. Zod's
 * `.strict()` survives `.partial()`, which is what makes a forged `userId` in the body a schema
 * rejection rather than something an ownership check has to remember to ignore (PRD §9.1).
 * Never redeclare this shape by hand.
 */
export const updatePayslipRequestSchema = canonicalPayslipFieldsSchema.partial();

export type UpdatePayslipRequest = z.infer<typeof updatePayslipRequestSchema>;

/** PRD §10.7 — `POST /api/payslips/:id/confirm` */
export const confirmPayslipResponseSchema = payslipSchema
  .pick({ id: true, status: true, confirmedAt: true })
  .strip();

export type ConfirmPayslipResponse = z.infer<typeof confirmPayslipResponseSchema>;

/** PRD §10.8 — `POST /api/payslips/:id/retry` */
export const retryPayslipResponseSchema = payslipSchema.pick({ id: true, status: true }).strip();

export type RetryPayslipResponse = z.infer<typeof retryPayslipResponseSchema>;

/**
 * PRD §10.11 — `POST /api/sessions/:id/merge`
 *
 * `order` is the page order of the merged PDF, so it must be the same two payslips.
 */
export const mergePayslipsRequestSchema = z
  .object({
    payslipIds: z.tuple([z.uuid(), z.uuid()]),
    order: z.tuple([z.uuid(), z.uuid()]),
  })
  .strict()
  .refine(({ payslipIds: [first, second] }) => first !== second, {
    message: "A payslip cannot be merged with itself",
    path: ["payslipIds"],
  })
  .refine(
    ({ payslipIds, order }) =>
      order[0] !== order[1] && order.every((id) => payslipIds.includes(id)),
    {
      message: "order must list the two payslips being merged",
      path: ["order"],
    },
  );

export type MergePayslipsRequest = z.infer<typeof mergePayslipsRequestSchema>;

export const mergePayslipsResponseSchema = payslipSchema.pick({ id: true, status: true }).strip();

export type MergePayslipsResponse = z.infer<typeof mergePayslipsResponseSchema>;

/**
 * PRD §10.12 — `GET /api/payslips`
 *
 * `page` and `limit` are counts arriving as query strings, which is the one place in this
 * codebase where coercing to a `number` is correct. Money never goes near it.
 */
export const listPayslipsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: payslipStatusSchema.optional(),
  })
  .strict();

export type ListPayslipsQuery = z.infer<typeof listPayslipsQuerySchema>;

export const listPayslipsResponseSchema = z
  .object({
    // The payslip itself is loosened too, not just the envelope: a new canonical field is exactly
    // the kind of additive change that lands here, and history is the screen a stale tab is most
    // likely to be sitting on.
    items: z.array(payslipSchema.strip()),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  })
  .strip();

export type ListPayslipsResponse = z.infer<typeof listPayslipsResponseSchema>;

/** PRD §10.14–10.15 — `GET /api/payslips/export` and `GET /api/payslips/:id/export` */
export const EXPORT_FORMATS = ["csv", "json"] as const;
export const exportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const EXPORT_SCHEMA_VERSION = 1;

export const exportedPayslipSchema = payslipSchema.omit({ userId: true, deletedAt: true });

export type ExportedPayslip = z.infer<typeof exportedPayslipSchema>;

/**
 * Strict, unlike the responses above: this is a file we write and a downstream consumer reads,
 * not a body a stale browser tab parses, so an unexpected key is a bug on our side.
 */
export const jsonExportResponseSchema = z
  .object({
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    payslips: z.array(exportedPayslipSchema),
  })
  .strict();

export type JsonExportResponse = z.infer<typeof jsonExportResponseSchema>;
