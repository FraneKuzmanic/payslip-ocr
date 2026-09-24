import type { NextFunction, Request, Response } from "express";
import type { ApiErrorResponse } from "@payslip/shared";
import { logger } from "../logger.js";

/**
 * Errors carry a stable machine `code` rather than prose, so the UI can translate them
 * (PRD §7.13). Never put provider or infrastructure detail in a code.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err instanceof HttpError ? err.status : 500;
  const code = err instanceof HttpError ? err.code : "internal_error";

  // Client errors are expected traffic — a URL scanner must not be able to flood
  // the error log or fill it with stack traces. Only server faults are errors.
  if (status >= 500) {
    logger.error({ err, status }, "request failed");
  } else {
    logger.warn({ status, code }, "request rejected");
  }

  const body: ApiErrorResponse = { error: { code } };
  res.status(status).json(body);
}
