import { describe, expect, it, vi } from "vitest";
import {
  ExtractionError,
  type DocumentExtractionProvider,
  type ExtractionInput,
  type ProviderExtractionResult,
} from "../providers/document-extraction/types.js";
import {
  createExtractionRunner,
  STALE_EXTRACTION_MS,
  type ExtractionJob,
} from "./payslip-extraction.js";

const result: ProviderExtractionResult = {
  fields: { netoPlaca: "2298.97" },
  metadata: {
    provider: "stub",
    modelId: "stub",
    apiVersion: "1",
    analyzedAt: "2026-09-24T10:00:00.000Z",
    latencyMs: 10,
    documentConfidence: null,
    fields: {},
    unreadableFields: [],
  },
  raw: { status: "Succeeded" },
};

function repository(overrides: Partial<ExtractionJob["repository"]> = {}) {
  return {
    completeExtraction: vi.fn(() => Promise.resolve(true)),
    failExtraction: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function job(payslipId: string, repo = repository()): ExtractionJob {
  return { payslipId, repository: repo, bytes: Buffer.from("x"), contentType: "image/png" };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createExtractionRunner", () => {
  it("runs at most `concurrency` analyses at once, in FIFO order", async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const provider: DocumentExtractionProvider = {
      async extract(input: ExtractionInput) {
        const id = input.bytes.toString();
        started.push(id);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await gates.get(id)?.promise;
        inFlight--;
        return result;
      },
    };
    const runner = createExtractionRunner({ provider, concurrency: 3, timeoutMs: 60_000 });
    const ids = ["1", "2", "3", "4", "5"];
    for (const id of ids) gates.set(id, deferred());

    const done = ids.map((id) => runner.enqueue({ ...job(id), bytes: Buffer.from(id) }));
    await vi.waitFor(() => expect(started).toEqual(["1", "2", "3"]));

    for (const id of ids) gates.get(id)?.resolve();
    await Promise.all(done);

    expect(peak).toBe(3);
    expect(started).toEqual(ids);
  });

  it("isolates one payslip's failure from its siblings", async () => {
    const repo = repository();
    const provider: DocumentExtractionProvider = {
      extract: (input) =>
        input.bytes.toString() === "bad"
          ? Promise.reject(new ExtractionError("unreadable_document"))
          : Promise.resolve(result),
    };
    const runner = createExtractionRunner({ provider, concurrency: 3, timeoutMs: 60_000 });

    await Promise.all(
      ["a", "b", "bad", "c", "d"].map((id) =>
        runner.enqueue({ ...job(id, repo), bytes: Buffer.from(id) }),
      ),
    );

    expect(repo.failExtraction).toHaveBeenCalledExactlyOnceWith("bad", "unreadable_document");
    expect(repo.completeExtraction).toHaveBeenCalledTimes(4);
    expect(repo.completeExtraction).toHaveBeenCalledWith("a", {
      fields: result.fields,
      metadata: result.metadata,
      raw: result.raw,
    });
  });

  it("records an unexpected error as provider_unavailable", async () => {
    const repo = repository();
    const provider: DocumentExtractionProvider = {
      extract: () => Promise.reject(new Error("boom")),
    };

    await createExtractionRunner({ provider, concurrency: 1, timeoutMs: 60_000 }).enqueue(
      job("p", repo),
    );

    expect(repo.failExtraction).toHaveBeenCalledExactlyOnceWith("p", "provider_unavailable");
  });

  it("does not fail a payslip whose completed result was discarded", async () => {
    const repo = repository({ completeExtraction: vi.fn(() => Promise.resolve(false)) });
    const provider: DocumentExtractionProvider = { extract: () => Promise.resolve(result) };

    await createExtractionRunner({ provider, concurrency: 1, timeoutMs: 60_000 }).enqueue(
      job("p", repo),
    );

    expect(repo.failExtraction).not.toHaveBeenCalled();
  });

  it("hands the provider a whole-analysis abort signal", async () => {
    const extract = vi.fn((_input: ExtractionInput) => Promise.resolve(result));

    await createExtractionRunner({
      provider: { extract },
      concurrency: 1,
      timeoutMs: 60_000,
    }).enqueue(job("p"));

    expect(extract.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("fails a job that waited too long to finish before the stale cutoff, without analysing it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const gate = deferred();
      const extract = vi.fn(async (_input: ExtractionInput) => {
        await gate.promise;
        return result;
      });
      const timeoutMs = 60_000;
      const runner = createExtractionRunner({ provider: { extract }, concurrency: 1, timeoutMs });
      const late = repository();

      const first = runner.enqueue(job("first"));
      const second = runner.enqueue(job("late", late));
      await vi.waitFor(() => expect(extract).toHaveBeenCalledOnce());
      vi.setSystemTime(Date.now() + STALE_EXTRACTION_MS - timeoutMs + 1);
      gate.resolve();
      await Promise.all([first, second]);

      expect(extract).toHaveBeenCalledOnce();
      expect(late.failExtraction).toHaveBeenCalledExactlyOnceWith("late", "provider_unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves even when recording the result throws, and frees its slot", async () => {
    const repo = repository({ completeExtraction: vi.fn(() => Promise.reject(new Error("db"))) });
    const provider: DocumentExtractionProvider = { extract: () => Promise.resolve(result) };
    const runner = createExtractionRunner({ provider, concurrency: 1, timeoutMs: 60_000 });

    await expect(runner.enqueue(job("p", repo))).resolves.toBeUndefined();
    await expect(runner.enqueue(job("q", repo))).resolves.toBeUndefined();
    expect(repo.completeExtraction).toHaveBeenCalledTimes(2);
  });
});
