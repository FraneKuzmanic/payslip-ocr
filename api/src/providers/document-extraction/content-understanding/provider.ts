import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ExtractionFailureReason } from "@payslip/shared";
import { logger } from "../../../logger.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
  type ExtractionInput,
  type ProviderExtractionResult,
} from "../types.js";
import { analyzerIdFor } from "./analyzer.js";
import { mapAnalyzeResult } from "./fields.js";

export interface ContentUnderstandingOptions {
  readonly endpoint: string;
  readonly key: string;
  /** The analyzer family: each pass analyses with `<family>_<pass>` (Task 05 D5). */
  readonly analyzerFamilyId: string;
  readonly apiVersion: string;
  /** 1 s by default (Task 04 D12); tests pass a tiny value. */
  readonly pollIntervalMs?: number;
  /** 5 s by default (ROADMAP locked decision 12); tests pass a tiny value. */
  readonly submitTimeoutMs?: number;
}

/**
 * Submit budget before abandoning and retrying — see SUBMIT_STALL note below. It runs from the
 * moment the request body has been sent, never from the start of the request.
 */
const DEFAULT_SUBMIT_TIMEOUT_MS = 5000;
/** Body chunk size; the body is streamed so the budget can start once the last chunk is taken. */
const BODY_CHUNK_BYTES = 64 * 1024;
const SUBMIT_TRIES = 4;

/**
 * SUBMIT_STALL: the service intermittently sits on `:analyzeBinary` for ~29s before returning
 * 202. Measured: TCP connect is always 0.07–0.14s, the delay is server-side, it is uncorrelated
 * with payload size (a 3.5 MB file submitted in 1.9s while a 72 KB one took 35s), and it survives
 * forcing IPv4. It always clears on a retry.
 *
 * Abandoning after 5s and resubmitting takes the mean from 43.5s to 10.9s. The trade-off is that
 * an abandoned request may still be queued server-side, so a stalled submit can cost a duplicate
 * analysis; at ~4 retries per 11 documents that is cheap relative to the latency won.
 *
 * The stall is the wait for a response AFTER the body has arrived, so the budget must not include
 * sending the body. Measured 2026-09-24: this development machine's uplink takes ~8 s to send
 * golden-set B02 (3.6 MB). A budget started at the request's start aborted every attempt, so the
 * document could never be submitted. Streaming the body and starting the budget when its last
 * chunk is taken tracks transmission: that chunk was taken at 7.0 s of an 8.3 s upload.
 */

const operationStatusSchema = z
  .object({
    status: z.string(),
    error: z.object({ code: z.string().optional() }).loose().optional(),
  })
  .loose();

/**
 * Azure AI Content Understanding over REST (`fetch`, no SDK). Failures are classified into the
 * three reasons of PRD §7.4 (Task 04 D9). Only codes and statuses are logged, never the service's
 * `message`, which may quote document text.
 */
export class ContentUnderstandingProvider implements DocumentExtractionProvider {
  readonly #options: ContentUnderstandingOptions;
  readonly #headers: Record<string, string>;
  readonly #pollIntervalMs: number;
  readonly #submitTimeoutMs: number;

  constructor(options: ContentUnderstandingOptions) {
    this.#options = options;
    this.#headers = { "Ocp-Apim-Subscription-Key": options.key };
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#submitTimeoutMs = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
  }

  async extract({
    bytes,
    contentType,
    signal,
    pass,
  }: ExtractionInput): Promise<ProviderExtractionResult> {
    const analyzerId = analyzerIdFor(this.#options.analyzerFamilyId, pass);
    const started = Date.now();
    const { operationUrl, attempts } = await this.#submitWithRetry(
      analyzerId,
      bytes,
      contentType,
      signal,
    );
    const submitted = Date.now();
    const body = await this.#poll(operationUrl, signal);
    const finished = Date.now();

    const mapped = mapAnalyzeResult(body, pass);
    if (mapped === null) {
      // Contract drift, not the document's fault.
      logger.error("content understanding result did not match the mapped shape");
      throw new ExtractionError("provider_unavailable");
    }
    const anyValue = Object.values(mapped.fields).some(
      (value) => value !== null && !(Array.isArray(value) && value.length === 0),
    );
    // PRD US-11: a blank or illegible page is a per-payslip failure the user retakes. Three empty
    // tables are a valid tables result (G01 prints no pay components), so only the scalars pass
    // needs a value (Task 05 D9).
    if (!mapped.hasText || (pass === "scalars" && !anyValue)) {
      throw new ExtractionError("unreadable_document");
    }

    return {
      fields: mapped.fields,
      metadata: {
        provider: "content-understanding",
        modelId: analyzerId,
        apiVersion: this.#options.apiVersion,
        analyzedAt: new Date(finished).toISOString(),
        latencyMs: finished - started,
        uploadMs: submitted - started,
        analyzeMs: finished - submitted,
        documentConfidence: null,
        fields: mapped.fieldMetadata,
        unreadableFields: mapped.unreadableFields,
        submitAttempts: attempts,
      },
      raw: body,
    };
  }

  async #submitWithRetry(
    analyzerId: string,
    bytes: Buffer,
    contentType: string,
    signal: AbortSignal,
  ): Promise<{ operationUrl: string; attempts: number }> {
    // `:analyze` takes JSON ({url: ...}) only; `:analyzeBinary` is the one that accepts raw
    // bytes, which is what we need for sources that must not be published anywhere.
    const { endpoint, apiVersion } = this.#options;
    const url = `${endpoint}/contentunderstanding/analyzers/${analyzerId}:analyzeBinary?api-version=${apiVersion}`;

    let lastStall: unknown;
    for (let attempt = 1; attempt <= SUBMIT_TRIES; attempt++) {
      const stall = new AbortController();
      let stallTimer: NodeJS.Timeout | undefined;
      const startStallBudget = () => {
        stallTimer = setTimeout(() => {
          stall.abort(new DOMException("submit stalled", "TimeoutError"));
        }, this.#submitTimeoutMs);
      };

      let response: Response;
      try {
        // `duplex` is required by Node for a streamed body, and missing from the DOM lib's type.
        const init: RequestInit & { duplex: "half" } = {
          method: "POST",
          headers: {
            ...this.#headers,
            "Content-Type": contentType,
            // Explicit, so the streamed body is not sent chunked.
            "Content-Length": String(bytes.length),
          },
          body: streamBody(bytes, startStallBudget),
          duplex: "half",
          signal: AbortSignal.any([signal, stall.signal]),
        };
        response = await fetch(url, init);
      } catch (error) {
        // The whole-analysis budget is spent: no further attempt.
        if (signal.aborted) throw new ExtractionError("provider_unavailable", error);
        if (error instanceof DOMException && error.name === "TimeoutError") {
          lastStall = error;
          continue;
        }
        throw new ExtractionError("provider_unavailable", error);
      } finally {
        clearTimeout(stallTimer);
      }

      if (!response.ok) {
        const reason = classifyHttpFailure(response, "submit");
        await response.body?.cancel();
        throw new ExtractionError(reason);
      }
      await response.body?.cancel();
      const operationUrl = response.headers.get("operation-location");
      if (operationUrl === null) {
        logger.error("content understanding submit returned no operation-location");
        throw new ExtractionError("provider_unavailable");
      }
      return { operationUrl, attempts: attempt };
    }
    throw new ExtractionError("provider_unavailable", lastStall);
  }

  async #poll(operationUrl: string, signal: AbortSignal): Promise<unknown> {
    for (;;) {
      let body: unknown;
      try {
        const response = await fetch(operationUrl, { headers: this.#headers, signal });
        if (!response.ok) {
          classifyHttpFailure(response, "poll");
          await response.body?.cancel();
          // Polling an accepted operation cannot be the document's fault.
          throw new ExtractionError("provider_unavailable");
        }
        body = await response.json();
      } catch (error) {
        if (error instanceof ExtractionError) throw error;
        throw new ExtractionError("provider_unavailable", error);
      }

      const operation = operationStatusSchema.safeParse(body);
      if (!operation.success) {
        logger.error("content understanding operation status did not match the expected shape");
        throw new ExtractionError("provider_unavailable");
      }
      const status = operation.data.status.toLowerCase();
      if (status === "succeeded") return body;
      if (status === "failed" || status === "canceled") {
        // The 2025-11-01 reference documents no error-code taxonomy, so every failed operation
        // is treated as transient; the observed codes are evidence for tightening that later.
        logger.error(
          { operationStatus: operation.data.status, errorCode: operation.data.error?.code },
          "content understanding operation did not succeed",
        );
        throw new ExtractionError("provider_unavailable");
      }

      try {
        await delay(this.#pollIntervalMs, undefined, { signal });
      } catch (error) {
        throw new ExtractionError("provider_unavailable", error);
      }
    }
  }
}

/**
 * `bytes` as a stream that calls `onSent` once its last chunk has been taken. `fetch` takes chunks
 * only as the connection drains, so that moment tracks the body leaving this process.
 */
function streamBody(bytes: Buffer, onSent: () => void): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          onSent();
          return;
        }
        controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + BODY_CHUNK_BYTES)));
        offset += BODY_CHUNK_BYTES;
      },
    },
    // No read-ahead: a chunk is produced only when fetch asks for one.
    { highWaterMark: 0 },
  );
}

/** Task 04 D9. Logs the status and the service's error code, never its message. */
function classifyHttpFailure(
  response: Response,
  phase: "submit" | "poll",
): ExtractionFailureReason {
  const { status } = response;
  const errorCode = response.headers.get("x-ms-error-code") ?? undefined;

  if (status === 401 || status === 403 || status === 404) {
    // Our misconfiguration (key, analyzer id), not the document: a retry works once it is fixed.
    logger.error({ phase, status, errorCode }, "content understanding refused our credentials");
    return "provider_unavailable";
  }
  logger.warn({ phase, status, errorCode }, "content understanding request failed");
  if (status === 408 || status === 429 || status >= 500) return "provider_unavailable";
  return "provider_rejected";
}
