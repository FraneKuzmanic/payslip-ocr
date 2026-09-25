import { Router } from "express";
import { z } from "zod";
import {
  isRetryableFailure,
  listPayslipsQuerySchema,
  type ListPayslipsResponse,
  type PayslipDetailResponse,
  type RetryPayslipResponse,
  type SourceDocumentResponse,
} from "@payslip/shared";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { PayslipRepository } from "../repositories/payslips.js";
import { STALE_EXTRACTION_MS, type ExtractionRunner } from "../services/payslip-extraction.js";
import {
  SOURCE_URL_TTL_SECONDS,
  createSourceSignedUrl,
  downloadSource,
  sourceObjectPath,
} from "../storage/payslip-sources.js";

const idSchema = z.uuid();

export function createPayslipsRouter(extraction: ExtractionRunner): Router {
  const router = Router();

  /** PRD §10.12. Owner scoping and soft-delete filtering live in the repository. */
  router.get(
    "/",
    authenticated(async (req, res, auth) => {
      const query = listPayslipsQuerySchema.safeParse(req.query);
      if (!query.success) throw new HttpError(400, "invalid_request");

      const repository = new PayslipRepository(auth.client, auth.userId);
      await repository.failStaleExtractions(new Date(Date.now() - STALE_EXTRACTION_MS));
      const page = await repository.listPage(query.data);
      const body: ListPayslipsResponse = {
        ...page,
        page: query.data.page,
        limit: query.data.limit,
      };
      res.json(body);
    }),
  );

  /** PRD §10.9. The URL is signed with a 300 s TTL; the path is derived, never stored. */
  router.get(
    "/:id/source",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const source = await new PayslipRepository(auth.client, auth.userId).findSourceById(id.data);
      if (source === null) throw new HttpError(404, "not_found");

      const url = await createSourceSignedUrl(auth.client, sourceObjectPath(auth.userId, id.data));
      const body: SourceDocumentResponse = {
        url,
        contentType: source.contentType,
        originalFilename: source.originalFilename,
        expiresAt: new Date(Date.now() + SOURCE_URL_TTL_SECONDS * 1000).toISOString(),
      };
      res.json(body);
    }),
  );

  /**
   * PRD §10.8 (Task 07 D8). A retryable failure is reset to a fresh extraction and re-enqueued with
   * its stored bytes. The bytes are downloaded before the reset, so a Storage failure leaves the
   * payslip `failed` and retryable rather than `processing` with no job behind it. The reset is one
   * conditional update: of two concurrent retries only one matches, so a double click pays for one
   * analysis. The stale reaper is deliberately not run here: a payslip that is only stale is still
   * `processing`, and becomes retryable once a read reaps it.
   */
  router.post(
    "/:id/retry",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new PayslipRepository(auth.client, auth.userId);
      // A fast refusal that downloads nothing; `beginRetry` below is the authoritative check.
      const state = await repository.findDetailState(id.data);
      if (state === null) throw new HttpError(404, "not_found");
      const { payslip, failureReason } = state;
      if (
        payslip.status !== "failed" ||
        failureReason === null ||
        !isRetryableFailure(failureReason)
      ) {
        throw new HttpError(409, "retry_not_allowed");
      }

      const source = await repository.findSourceById(id.data);
      if (source === null) throw new HttpError(404, "not_found");
      const bytes = await downloadSource(auth.client, sourceObjectPath(auth.userId, id.data));

      const retried = await repository.beginRetry(id.data);
      if (retried === null) throw new HttpError(409, "retry_not_allowed");

      void extraction.enqueue({
        payslipId: retried.id,
        repository,
        bytes,
        contentType: source.contentType,
      });
      const body: RetryPayslipResponse = { id: retried.id, status: retried.status };
      res.status(202).json(body);
    }),
  );

  /**
   * PRD §10.5. A payslip owned by someone else returns 404, never 403: telling a caller that an
   * id exists but is not theirs leaks exactly what ownership is meant to hide.
   *
   * There is deliberately no ownership check here. The repository filters on `user_id` and
   * `deleted_at`, and RLS enforces the same rule at the database.
   */
  router.get(
    "/:id",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new PayslipRepository(auth.client, auth.userId);
      await repository.failStaleExtractions(new Date(Date.now() - STALE_EXTRACTION_MS));
      const state = await repository.findDetailState(id.data);
      if (state === null) throw new HttpError(404, "not_found");

      const body: PayslipDetailResponse = {
        ...state.payslip,
        lowConfidenceFields: state.lowConfidenceFields,
        unreadableFields: state.unreadableFields,
        ungroundableFields: state.ungroundableFields,
        editedFields: state.editedFields,
        failureReason: state.failureReason,
      };
      res.json(body);
    }),
  );

  /** PRD §10.13. Soft delete; the source object is kept, so the delete stays reversible. */
  router.delete(
    "/:id",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const deleted = await new PayslipRepository(auth.client, auth.userId).softDelete(id.data);
      if (deleted === null) throw new HttpError(404, "not_found");
      res.status(204).end();
    }),
  );

  return router;
}
