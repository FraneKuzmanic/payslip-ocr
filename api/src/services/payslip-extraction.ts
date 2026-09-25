import type { SourceContentType } from "@payslip/shared";
import type { Json } from "../database.types.js";
import { logger } from "../logger.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
  type ExtractionPass,
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
  readonly repository: Pick<
    PayslipRepository,
    "completeExtractionPass" | "failExtraction" | "failTablesExtraction"
  >;
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

export interface ExtractionRunner {
  /** Resolves when both passes have finished and been recorded. Never rejects. */
  enqueue(job: ExtractionJob): Promise<void>;
}

export interface ExtractionRunnerDeps {
  readonly provider: DocumentExtractionProvider;
  /** Concurrent analyses, not payslips: each payslip runs two passes (PRD §7.3, Task 05 D8). */
  readonly concurrency: number;
  /** Per pass. */
  readonly timeoutMs: number;
}

/**
 * In-process background extraction (PRD §7.3). Each payslip is analysed in two passes (Task 05):
 * the scalars pass makes the form usable, the tables pass fills the line-item tables. At most
 * `concurrency` analyses run at once, each under its own timeout. A freed slot goes to a waiting
 * scalars pass before any tables pass, so every form appears before the last tables start; within
 * a pass, first in first out. One payslip's failure never touches another's.
 */
export function createExtractionRunner(deps: ExtractionRunnerDeps): ExtractionRunner {
  const acquire = createPrioritySemaphore(deps.concurrency);

  return {
    async enqueue(job) {
      const enqueuedAt = Date.now();
      // Aborted when the scalars pass fails or its result cannot be kept. The tables would then be
      // discarded, so a queued tables pass never calls the provider and a running one stops.
      const tablesAbort = new AbortController();
      const runPass = async (pass: ExtractionPass) => {
        const release = await acquire(pass);
        try {
          if (pass === "scalars") await runScalars(deps, job, enqueuedAt, tablesAbort);
          else await runTables(deps, job, enqueuedAt, tablesAbort.signal);
        } finally {
          release();
        }
      };
      await Promise.all([runPass("scalars"), runPass("tables")]);
    },
  };
}

async function runScalars(
  deps: ExtractionRunnerDeps,
  job: ExtractionJob,
  enqueuedAt: number,
  tablesAbort: AbortController,
): Promise<void> {
  const { payslipId } = job;
  const pass = "scalars";
  try {
    const signal = AbortSignal.timeout(deps.timeoutMs);
    const extracted = await extract(deps, job, pass, enqueuedAt, signal);
    if ("failure" in extracted) {
      tablesAbort.abort();
      const recorded = await job.repository.failExtraction(payslipId, extracted.failure.reason);
      logFailure(payslipId, pass, recorded ? "failed" : "discarded", extracted);
      return;
    }
    const recorded = await record(job, pass, extracted);
    // Discarded means the payslip was deleted or reaped: its tables would be discarded too.
    if (!recorded) tablesAbort.abort();
    logSuccess(payslipId, pass, recorded ? "review" : "discarded", extracted);
  } catch (error) {
    // Recording failed. The row stays `processing` until the stale reaper fails it (Task 04 D3),
    // so its tables would be discarded: do not pay for them.
    tablesAbort.abort();
    logger.error({ err: error, payslipId, pass }, "extraction result could not be recorded");
  }
}

async function runTables(
  deps: ExtractionRunnerDeps,
  job: ExtractionJob,
  enqueuedAt: number,
  cancelled: AbortSignal,
): Promise<void> {
  const { payslipId } = job;
  const pass = "tables";
  try {
    if (cancelled.aborted) {
      const recorded = await job.repository.failTablesExtraction(payslipId);
      logger.info(
        { payslipId, pass, outcome: recorded ? "cancelled" : "discarded" },
        recorded ? "extraction pass finished" : "extraction pass result discarded",
      );
      return;
    }
    const signal = AbortSignal.any([AbortSignal.timeout(deps.timeoutMs), cancelled]);
    const extracted = await extract(deps, job, pass, enqueuedAt, signal);
    if ("failure" in extracted) {
      // Only the tables are lost; the payslip stays usable (Task 05 D9). The reason is logged.
      const recorded = await job.repository.failTablesExtraction(payslipId);
      const outcome = !recorded ? "discarded" : cancelled.aborted ? "cancelled" : "failed";
      logFailure(payslipId, pass, outcome, extracted);
      return;
    }
    const recorded = await record(job, pass, extracted);
    logSuccess(payslipId, pass, recorded ? "ready" : "discarded", extracted);
  } catch (error) {
    // The stale reaper fails pending tables (Task 05 D10).
    logger.error({ err: error, payslipId, pass }, "extraction result could not be recorded");
  }
}

interface Succeeded {
  readonly result: ProviderExtractionResult;
  readonly queuedMs: number;
}

interface Failed {
  readonly failure: ExtractionError;
  readonly queuedMs: number;
}

/** One provider call with every failure classified. Never throws. */
async function extract(
  deps: ExtractionRunnerDeps,
  job: ExtractionJob,
  pass: ExtractionPass,
  enqueuedAt: number,
  signal: AbortSignal,
): Promise<Succeeded | Failed> {
  const { payslipId } = job;
  // Enqueue to provider call: the wait a user sits through before the analysis starts.
  const queuedMs = Date.now() - enqueuedAt;
  try {
    if (queuedMs + deps.timeoutMs > STALE_EXTRACTION_MS) {
      logger.warn({ payslipId, pass, queuedMs }, "extraction expired in the queue");
      throw new ExtractionError("provider_unavailable");
    }
    const result = await deps.provider.extract({
      bytes: job.bytes,
      contentType: job.contentType,
      signal,
      pass,
    });
    return { result, queuedMs };
  } catch (error) {
    const failure =
      error instanceof ExtractionError ? error : new ExtractionError("provider_unavailable", error);
    if (failure !== error)
      logger.error({ err: error, payslipId, pass }, "extraction threw unexpectedly");
    return { failure, queuedMs };
  }
}

function record(
  job: ExtractionJob,
  pass: ExtractionPass,
  { result, queuedMs }: Succeeded,
): Promise<boolean> {
  return job.repository.completeExtractionPass(job.payslipId, pass, {
    fields: result.fields,
    // Plain JSON by construction; an interface just carries no index signature to prove it.
    metadata: { ...result.metadata, queuedMs } as unknown as Json,
    raw: result.raw as Json,
  });
}

function logSuccess(
  payslipId: string,
  pass: ExtractionPass,
  outcome: string,
  { result: { metadata }, queuedMs }: Succeeded,
): void {
  logger.info(
    {
      payslipId,
      pass,
      outcome,
      queuedMs,
      latencyMs: metadata.latencyMs,
      uploadMs: metadata.uploadMs,
      analyzeMs: metadata.analyzeMs,
      submitAttempts: metadata.submitAttempts,
      extractedFieldCount: Object.keys(metadata.fields).length,
      unreadableCount: metadata.unreadableFields.length,
    },
    outcome === "discarded" ? "extraction pass result discarded" : "extraction pass finished",
  );
}

function logFailure(
  payslipId: string,
  pass: ExtractionPass,
  outcome: string,
  { failure, queuedMs }: Failed,
): void {
  // `warn`: a failed pass is the line that says why, and must survive a quieter log level.
  logger.warn(
    { payslipId, pass, outcome, queuedMs, reason: failure.reason, retryable: failure.retryable },
    outcome === "discarded" ? "extraction pass result discarded" : "extraction pass finished",
  );
}

/**
 * A counting semaphore with one FIFO queue per pass: a released slot goes to a waiting scalars pass
 * before any tables pass (Task 05 D8). `acquire` resolves with the matching `release`.
 */
function createPrioritySemaphore(limit: number): (pass: ExtractionPass) => Promise<() => void> {
  let active = 0;
  const waiting: Record<ExtractionPass, (() => void)[]> = { scalars: [], tables: [] };

  const release = () => {
    const next = waiting.scalars.shift() ?? waiting.tables.shift();
    if (next === undefined) active--;
    else next();
  };

  return (pass) => {
    if (active < limit) {
      active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      waiting[pass].push(() => resolve(release));
    });
  };
}
