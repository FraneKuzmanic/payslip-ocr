import { Router } from "express";
import { z } from "zod";
import {
  listPayslipsQuerySchema,
  type ListPayslipsResponse,
  type PayslipDetailResponse,
  type SourceDocumentResponse,
} from "@payslip/shared";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { PayslipRepository } from "../repositories/payslips.js";
import {
  SOURCE_URL_TTL_SECONDS,
  createSourceSignedUrl,
  sourceObjectPath,
} from "../storage/payslip-sources.js";

const idSchema = z.uuid();

export function createPayslipsRouter(): Router {
  const router = Router();

  /** PRD §10.12. Owner scoping and soft-delete filtering live in the repository. */
  router.get(
    "/",
    authenticated(async (req, res, auth) => {
      const query = listPayslipsQuerySchema.safeParse(req.query);
      if (!query.success) throw new HttpError(400, "invalid_request");

      const page = await new PayslipRepository(auth.client, auth.userId).listPage(query.data);
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

      const state = await new PayslipRepository(auth.client, auth.userId).findDetailState(id.data);
      if (state === null) throw new HttpError(404, "not_found");

      const body: PayslipDetailResponse = {
        ...state.payslip,
        // Projections over `extraction_metadata`, which Task 04 populates.
        lowConfidenceFields: [],
        unreadableFields: [],
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
