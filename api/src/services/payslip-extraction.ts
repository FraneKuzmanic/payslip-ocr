import type { SourceContentType } from "@payslip/shared";
import type { Json } from "../database.types.js";
import { logger } from "../logger.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
  type ProviderExtractionResult,
} from "../providers/document-extraction/types.js";
import type { PayslipRepository } from "../repositories/payslips.js";

/**
 * A `processing` payslip untouched for this long is failed on the next read (Task 04 D3). The queue
 * is shared by every user and unbounded, so the runner fails a job that could no longer finish
 * inside this window rather than analysing it at a cost and having its result discarded.
 */
export const STALE_EXTRACTION_MS = 15 * 60 * 1000;

export interface ExtractionJob {
  readonly payslipId: string;
  /** Scoped to the uploading user: every write goes through their RLS (Task 04 D2). */
  readonly repository: Pick<PayslipRepository, "completeExtraction" | "failExtraction">;
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

export interface ExtractionRunner {
  /** Resolves when the job has finished and been recorded. Never rejects. */
  enqueue(job: ExtractionJob): Promise<void>;
}

export interface ExtractionRunnerDeps {
  readonly provider: DocumentExtractionProvider;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

/**
 * In-process background extraction (PRD §7.3): at most `concurrency` analyses at once, first in
 * first out, each under a whole-analysis timeout. One payslip's failure never touches another's.
 */
export function createExtractionRunner(deps: ExtractionRunnerDeps): ExtractionRunner {
  const acquire = createSemaphore(deps.concurrency);

  return {
    async enqueue(job) {
      const enqueuedAt = Date.now();
      const release = await acquire();
      try {
        await run(deps, job, enqueuedAt);
      } finally {
        release();
      }
    },
  };
}

async function run(
  deps: ExtractionRunnerDeps,
  job: ExtractionJob,
  enqueuedAt: number,
): Promise<void> {
  const { payslipId } = job;
  try {
    let result: ProviderExtractionResult;
    try {
      const queuedMs = Date.now() - enqueuedAt;
      if (queuedMs + deps.timeoutMs > STALE_EXTRACTION_MS) {
        logger.warn({ payslipId, queuedMs }, "extraction expired in the queue");
        throw new ExtractionError("provider_unavailable");
      }
      result = await deps.provider.extract({
        bytes: job.bytes,
        contentType: job.contentType,
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (error) {
      const failure =
        error instanceof ExtractionError
          ? error
          : new ExtractionError("provider_unavailable", error);
      if (failure !== error)
        logger.error({ err: error, payslipId }, "extraction threw unexpectedly");

      const recorded = await job.repository.failExtraction(payslipId, failure.reason);
      logger.info(
        {
          payslipId,
          outcome: recorded ? "failed" : "discarded",
          reason: failure.reason,
          retryable: failure.retryable,
        },
        recorded ? "extraction finished" : "extraction result discarded",
      );
      return;
    }

    const { metadata } = result;
    const recorded = await job.repository.completeExtraction(payslipId, {
      fields: result.fields,
      // Plain JSON by construction; an interface just carries no index signature to prove it.
      metadata: metadata as unknown as Json,
      raw: result.raw as Json,
    });
    logger.info(
      {
        payslipId,
        outcome: recorded ? "review" : "discarded",
        latencyMs: metadata.latencyMs,
        uploadMs: metadata.uploadMs,
        analyzeMs: metadata.analyzeMs,
        submitAttempts: metadata.submitAttempts,
        extractedFieldCount: Object.keys(metadata.fields).length,
        unreadableCount: metadata.unreadableFields.length,
      },
      recorded ? "extraction finished" : "extraction result discarded",
    );
  } catch (error) {
    // Recording failed. The row stays `processing` until the stale reaper fails it (D3).
    logger.error({ err: error, payslipId }, "extraction result could not be recorded");
  }
}

/** A plain FIFO counting semaphore. `acquire` resolves with the matching `release`. */
function createSemaphore(limit: number): () => Promise<() => void> {
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    const next = waiting.shift();
    if (next === undefined) active--;
    else next();
  };

  return () => {
    if (active < limit) {
      active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      waiting.push(() => resolve(release));
    });
  };
}
