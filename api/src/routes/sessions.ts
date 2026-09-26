import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  isMergeable,
  mergePayslipsRequestSchema,
  mergeSuggestions,
  mergedFilename,
  type CreatePayslipResponse,
  type CreateSessionResponse,
  type MergePayslipsResponse,
  type Payslip,
  type SessionDetailResponse,
} from "@payslip/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { PayslipRepository, PayslipRepositoryError } from "../repositories/payslips.js";
import { SessionRepository } from "../repositories/sessions.js";
import { STALE_EXTRACTION_MS, type ExtractionRunner } from "../services/payslip-extraction.js";
import { MergeSourceError, combineSources } from "../services/payslip-merge.js";
import {
  downloadSource,
  removeSource,
  sourceObjectPath,
  uploadSource,
} from "../storage/payslip-sources.js";
import { sourceFileUpload } from "../upload/multipart.js";
import { validateSourceFile } from "../upload/source-file.js";

const idSchema = z.uuid();

export function createSessionsRouter(extraction: ExtractionRunner): Router {
  const router = Router();

  /** PRD §10.2. */
  router.post(
    "/",
    authenticated(async (_req, res, auth) => {
      const session = await new SessionRepository(auth.client, auth.userId).create();
      const body: CreateSessionResponse = { id: session.id, createdAt: session.createdAt };
      res.status(201).json(body);
    }),
  );

  /**
   * PRD §10.3. One Source File becomes one Payslip. The ten-payslip cap is not checked here: the
   * `payslips` insert trigger is its only enforcement point, because parallel uploads race any
   * count made in Node.
   */
  router.post(
    "/:id/payslips",
    sourceFileUpload,
    authenticated(async (req, res, auth) => {
      const sessionId = idSchema.safeParse(req.params["id"]);
      if (!sessionId.success) throw new HttpError(400, "invalid_request");

      // Before the file is inspected, so a foreign session id learns nothing about the upload.
      const session = await new SessionRepository(auth.client, auth.userId).findById(
        sessionId.data,
      );
      if (session === null) throw new HttpError(404, "not_found");

      const file = await validateSourceFile(req.file);
      const payslipId = randomUUID();
      const path = sourceObjectPath(auth.userId, payslipId);
      await uploadSource(auth.client, path, file.bytes, file.contentType);

      const repository = new PayslipRepository(auth.client, auth.userId);
      let payslip: Payslip;
      try {
        payslip = await repository.create({
          id: payslipId,
          sessionId: session.id,
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          pageCount: file.pageCount,
        });
      } catch (error) {
        // `invalid_data` means the row was committed and only mapping it back failed, so its
        // source must stay.
        if (!(error instanceof PayslipRepositoryError && error.code === "invalid_data")) {
          try {
            await removeSource(auth.client, path);
          } catch (cleanupError) {
            // The row error is what the caller needs; the orphan is recorded for the operator.
            logger.warn({ err: cleanupError }, "orphaned payslip source");
          }
        }
        if (error instanceof PayslipRepositoryError && error.code === "session_full") {
          throw new HttpError(409, "session_full");
        }
        throw error;
      }

      // PRD §7.3: the upload starts extraction immediately and returns 201 without waiting. Only
      // after the insert succeeded, so a refused upload never reaches the provider.
      void extraction.enqueue({
        payslipId: payslip.id,
        repository,
        bytes: file.bytes,
        contentType: file.contentType,
      });
      const body: CreatePayslipResponse = {
        id: payslip.id,
        sessionId: payslip.sessionId,
        status: payslip.status,
        createdAt: payslip.createdAt,
      };
      res.status(201).json(body);
    }),
  );

  /**
   * PRD §10.11 (plan 11 D3, D4, D8). Combines both sources into one PDF in `order`, stores it, and
   * replaces the two payslips with one that re-extracts. The checks here are fast refusals that
   * download nothing; `merge_payslips` is authoritative. The originals' sources are kept, as for any
   * soft delete.
   */
  router.post(
    "/:id/merge",
    authenticated(async (req, res, auth) => {
      const sessionId = idSchema.safeParse(req.params["id"]);
      const request = mergePayslipsRequestSchema.safeParse(req.body);
      if (!sessionId.success || !request.success) throw new HttpError(400, "invalid_request");

      const session = await new SessionRepository(auth.client, auth.userId).findById(
        sessionId.data,
      );
      if (session === null) throw new HttpError(404, "not_found");

      const repository = new PayslipRepository(auth.client, auth.userId);
      const listed = await repository.listBySession(session.id);
      const [first, second] = request.data.order.map((id) =>
        listed.find(({ payslip }) => payslip.id === id),
      );
      if (
        first === undefined ||
        second === undefined ||
        ![first, second].every(({ payslip }) => isMergeable(payslip.status, payslip.tablesStatus))
      ) {
        throw new HttpError(409, "merge_not_allowed");
      }

      const sources = await Promise.all(
        request.data.order.map(async (id) => {
          const source = await repository.findSourceById(id);
          if (source === null) throw new HttpError(409, "merge_not_allowed");
          const bytes = await downloadSource(auth.client, sourceObjectPath(auth.userId, id));
          return { bytes, contentType: source.contentType };
        }),
      );

      let combined;
      try {
        combined = await combineSources(sources);
      } catch (error) {
        if (error instanceof MergeSourceError) {
          logger.warn({ err: error.cause }, "merge source unreadable");
          throw new HttpError(422, "merge_source_unreadable");
        }
        throw error;
      }
      if (combined.pageCount > config.MAX_PDF_PAGES) {
        throw new HttpError(422, "pdf_too_many_pages");
      }
      // The upload's size cap holds for the combined file too, which the storage bucket also caps.
      if (combined.bytes.length > config.MAX_UPLOAD_BYTES) {
        throw new HttpError(422, "file_too_large");
      }

      const id = randomUUID();
      const path = sourceObjectPath(auth.userId, id);
      await uploadSource(auth.client, path, combined.bytes, "application/pdf");

      let merged: boolean;
      try {
        merged = await repository.merge({
          sessionId: session.id,
          id,
          order: request.data.order,
          originalFilename: mergedFilename(first.originalFilename, second.originalFilename),
          pageCount: combined.pageCount,
        });
      } catch (error) {
        await removeOrphan(auth.client, path);
        throw error;
      }
      if (!merged) {
        await removeOrphan(auth.client, path);
        throw new HttpError(409, "merge_not_allowed");
      }

      logger.info(
        { payslipId: id, mergedFrom: request.data.order, pageCount: combined.pageCount },
        "payslips merged",
      );
      void extraction.enqueue({
        payslipId: id,
        repository,
        bytes: combined.bytes,
        contentType: "application/pdf",
      });
      const body: MergePayslipsResponse = { id, status: "processing" };
      res.status(202).json(body);
    }),
  );

  /** PRD §10.4. A foreign session is 404: the owner-scoped query and RLS are the check. */
  router.get(
    "/:id",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new PayslipRepository(auth.client, auth.userId);
      // A client polls this route, so it is where an extraction lost to a redeploy surfaces (D3).
      await repository.failStaleExtractions(new Date(Date.now() - STALE_EXTRACTION_MS));

      const session = await new SessionRepository(auth.client, auth.userId).findById(id.data);
      if (session === null) throw new HttpError(404, "not_found");

      const payslips = await repository.listBySession(session.id);
      const body: SessionDetailResponse = {
        id: session.id,
        createdAt: session.createdAt,
        payslips: payslips.map(({ payslip, failureReason, originalFilename }) => ({
          id: payslip.id,
          status: payslip.status,
          tablesStatus: payslip.tablesStatus,
          period: payslip.period ?? null,
          employeeName: payslip.employeeName ?? null,
          pageCount: payslip.pageCount,
          failureReason,
          warningCount: payslip.warnings.length,
          originalFilename,
        })),
        mergeSuggestions: mergeSuggestions(payslips.map(({ payslip }) => payslip)),
      };
      res.json(body);
    }),
  );

  return router;
}

/** A stored source whose row was refused. The row outcome is what the caller needs. */
async function removeOrphan(
  client: Parameters<typeof removeSource>[0],
  path: string,
): Promise<void> {
  try {
    await removeSource(client, path);
  } catch (cleanupError) {
    logger.warn({ err: cleanupError }, "orphaned payslip source");
  }
}
