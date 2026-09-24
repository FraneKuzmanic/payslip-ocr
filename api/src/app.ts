import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { HEALTH_PATH } from "@payslip/shared";
import { createSupabaseAuthenticator, type Authenticator } from "./auth/authenticator.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { HttpError, errorHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/require-auth.js";
import { createDocumentExtractionProvider } from "./providers/document-extraction/content-understanding/index.js";
import { healthRouter } from "./routes/health.js";
import { createPayslipsRouter } from "./routes/payslips.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createExtractionRunner, type ExtractionRunner } from "./services/payslip-extraction.js";

export interface AppOptions {
  /** Injected by tests. Built lazily otherwise, so importing this module creates no client. */
  authenticator?: Authenticator;
  /** Injected by tests that must never reach the extraction provider. */
  extraction?: ExtractionRunner;
}

/**
 * Builds the Express application without binding a port, so tests can drive it directly.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const authenticator = options.authenticator ?? createSupabaseAuthenticator();
  const extraction =
    options.extraction ??
    createExtractionRunner({
      provider: createDocumentExtractionProvider(),
      concurrency: config.EXTRACTION_CONCURRENCY,
      timeoutMs: config.EXTRACTION_TIMEOUT_MS,
    });

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(HEALTH_PATH, healthRouter);

  // Guarding the prefixes, not routes, is what makes every session/payslip route protected by
  // default — and what makes a path with no route answer 401 rather than 404.
  app.use(["/api/sessions", "/api/payslips"], requireAuth(authenticator));
  app.use("/api/sessions", createSessionsRouter(extraction));
  app.use("/api/payslips", createPayslipsRouter());

  app.use((_req, _res, next) => {
    next(new HttpError(404, "not_found"));
  });

  // Must stay last: Express only treats a four-argument middleware as an error handler.
  app.use(errorHandler);

  return app;
}
