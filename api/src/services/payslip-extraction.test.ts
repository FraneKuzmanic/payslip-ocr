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
    completeExtractionPass: vi.fn(() => Promise.resolve(true)),
    failExtraction: vi.fn(() => Promise.resolve(true)),
    failTablesExtraction: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function job(payslipId: string, repo = repository()): ExtractionJob {
  return {
    payslipId,
    repository: repo,
    bytes: Buffer.from(payslipId),
    contentType: "image/png",
  };
}

/** `payslipId:pass`, the unit the runner schedules. */
const key = (input: ExtractionInput) => `${input.bytes.toString()}:${input.pass}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A provider whose every analysis waits on its own gate, recording the start order. */
function gatedProvider() {
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const started: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const gate = (name: string) => {
    let entry = gates.get(name);
    if (entry === undefined) {
      entry = deferred();
      gates.set(name, entry);
    }
    return entry;
  };
  const provider: DocumentExtractionProvider = {
    async extract(input) {
      started.push(key(input));
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gate(key(input)).promise;
      inFlight--;
      return result;
    },
  };
  return { provider, started, open: (name: string) => gate(name).resolve(), peak: () => peak };
}

describe("createExtractionRunner", () => {
  it("runs both passes of one payslip at once and resolves once both are recorded", async () => {
    const repo = repository();
    const { provider, started, open } = gatedProvider();
    const runner = createExtractionRunner({ provider, concurrency: 3, timeoutMs: 60_000 });

    let resolved = false;
    const done = runner.enqueue(job("a", repo)).then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(started).toEqual(["a:scalars", "a:tables"]));

    open("a:scalars");
    await vi.waitFor(() =>
      expect(repo.completeExtractionPass).toHaveBeenCalledWith("a", "scalars", expect.anything()),
    );
    expect(resolved).toBe(false);

    open("a:tables");
    await done;
    expect(repo.completeExtractionPass).toHaveBeenCalledWith("a", "tables", expect.anything());
  });

  it("runs at most `concurrency` analyses at once", async () => {
    const { provider, started, open, peak } = gatedProvider();
    const runner = createExtractionRunner({ provider, concurrency: 3, timeoutMs: 60_000 });
    const ids = ["1", "2", "3"];

    const done = ids.map((id) => runner.enqueue(job(id)));
    await vi.waitFor(() => expect(started).toHaveLength(3));
    for (const id of ids) {
      open(`${id}:scalars`);
      open(`${id}:tables`);
    }
    await Promise.all(done);

    expect(peak()).toBe(3);
    expect(started).toHaveLength(6);
  });

  it("serves every waiting scalars pass before any tables pass, each in FIFO order", async () => {
    const { provider, started, open } = gatedProvider();
    const runner = createExtractionRunner({ provider, concurrency: 1, timeoutMs: 60_000 });

    const done = [runner.enqueue(job("A")), runner.enqueue(job("B")), runner.enqueue(job("C"))];
    const order = ["A:scalars", "B:scalars", "C:scalars", "A:tables", "B:tables", "C:tables"];
    for (const [index, name] of order.entries()) {
      await vi.waitFor(() => expect(started).toHaveLength(index + 1));
      open(name);
    }
    await Promise.all(done);

    expect(started).toEqual(order);
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

    await Promise.all(["a", "b", "bad", "c", "d"].map((id) => runner.enqueue(job(id, repo))));

    expect(repo.failExtraction).toHaveBeenCalledExactlyOnceWith("bad", "unreadable_document");
    expect(repo.failTablesExtraction).toHaveBeenCalledExactlyOnceWith("bad");
    expect(repo.completeExtractionPass).toHaveBeenCalledTimes(8);
    expect(repo.completeExtractionPass).toHaveBeenCalledWith("a", "scalars", {
      fields: result.fields,
      metadata: { ...result.metadata, queuedMs: expect.any(Number) },
      raw: result.raw,
    });
  });

  it("never calls the provider for a queued tables pass once its scalars pass has failed", async () => {
    const repo = repository();
    const extract = vi.fn((input: ExtractionInput) =>
      input.pass === "scalars"
        ? Promise.reject(new ExtractionError("unreadable_document"))
        : Promise.resolve(result),
    );

    await createExtractionRunner({
      provider: { extract },
      concurrency: 1,
      timeoutMs: 60_000,
    }).enqueue(job("p", repo));

    expect(extract.mock.calls.map(([input]) => input.pass)).toEqual(["scalars"]);
    expect(repo.failExtraction).toHaveBeenCalledExactlyOnceWith("p", "unreadable_document");
    expect(repo.failTablesExtraction).toHaveBeenCalledExactlyOnceWith("p");
  });

  it("aborts a running tables pass when its scalars pass fails", async () => {
    const repo = repository();
    const scalarsGate = deferred();
    let tablesSignal: AbortSignal | undefined;
    const provider: DocumentExtractionProvider = {
      async extract(input) {
        if (input.pass === "scalars") {
          await scalarsGate.promise;
          throw new ExtractionError("unreadable_document");
        }
        tablesSignal = input.signal;
        await new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => {
            reject(new ExtractionError("provider_unavailable"));
          });
        });
        return result;
      },
    };

    const done = createExtractionRunner({ provider, concurrency: 2, timeoutMs: 60_000 }).enqueue(
      job("p", repo),
    );
    await vi.waitFor(() => expect(tablesSignal).toBeDefined());
    expect(tablesSignal?.aborted).toBe(false);
    scalarsGate.resolve();
    await done;

    expect(tablesSignal?.aborted).toBe(true);
    expect(repo.failTablesExtraction).toHaveBeenCalledExactlyOnceWith("p");
    expect(repo.completeExtractionPass).not.toHaveBeenCalled();
  });

  it("keeps the scalars result when only the tables pass fails", async () => {
    const repo = repository();
    const provider: DocumentExtractionProvider = {
      extract: (input) =>
        input.pass === "tables"
          ? Promise.reject(new ExtractionError("provider_unavailable"))
          : Promise.resolve(result),
    };

    await createExtractionRunner({ provider, concurrency: 2, timeoutMs: 60_000 }).enqueue(
      job("p", repo),
    );

    expect(repo.completeExtractionPass).toHaveBeenCalledExactlyOnceWith(
      "p",
      "scalars",
      expect.anything(),
    );
    expect(repo.failTablesExtraction).toHaveBeenCalledExactlyOnceWith("p");
    expect(repo.failExtraction).not.toHaveBeenCalled();
  });

  it("records each pass's queue wait in its metadata", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const repo = repository();
      const { provider, started, open } = gatedProvider();
      const runner = createExtractionRunner({ provider, concurrency: 1, timeoutMs: 60_000 });

      const done = runner.enqueue(job("p", repo));
      await vi.waitFor(() => expect(started).toEqual(["p:scalars"]));
      vi.setSystemTime(Date.now() + 5000);
      open("p:scalars");
      await vi.waitFor(() => expect(started).toEqual(["p:scalars", "p:tables"]));
      open("p:tables");
      await done;

      const queued = Object.fromEntries(
        vi
          .mocked(repo.completeExtractionPass)
          .mock.calls.map(([, pass, written]) => [
            pass,
            (written.metadata as { queuedMs: number }).queuedMs,
          ]),
      );
      // `vi.waitFor` steps the faked clock by its poll interval, so not exactly zero.
      expect(queued.scalars).toBeLessThan(5000);
      // The tables pass waited for the only slot while the scalars pass held it.
      expect(queued.tables).toBeGreaterThanOrEqual(5000);
    } finally {
      vi.useRealTimers();
    }
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

  it("does not fail a payslip whose scalars result was discarded, and skips its tables", async () => {
    const repo = repository({ completeExtractionPass: vi.fn(() => Promise.resolve(false)) });
    const extract = vi.fn((_input: ExtractionInput) => Promise.resolve(result));

    await createExtractionRunner({
      provider: { extract },
      concurrency: 1,
      timeoutMs: 60_000,
    }).enqueue(job("p", repo));

    expect(repo.failExtraction).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledOnce();
  });

  it("hands each pass a whole-analysis abort signal and its pass", async () => {
    const extract = vi.fn((_input: ExtractionInput) => Promise.resolve(result));

    await createExtractionRunner({
      provider: { extract },
      concurrency: 2,
      timeoutMs: 60_000,
    }).enqueue(job("p"));

    const inputs = extract.mock.calls.map(([input]) => input);
    expect(inputs.map((input) => input.pass).toSorted()).toEqual(["scalars", "tables"]);
    for (const input of inputs) expect(input.signal).toBeInstanceOf(AbortSignal);
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

      // Only the first payslip's scalars pass ran; its tables pass also expired in the queue.
      expect(extract).toHaveBeenCalledOnce();
      expect(late.failExtraction).toHaveBeenCalledExactlyOnceWith("late", "provider_unavailable");
      expect(late.failTablesExtraction).toHaveBeenCalledExactlyOnceWith("late");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves even when recording the result throws, frees its slots and skips the tables", async () => {
    const repo = repository({
      completeExtractionPass: vi.fn(() => Promise.reject(new Error("db"))),
    });
    const extract = vi.fn((_input: ExtractionInput) => Promise.resolve(result));
    const runner = createExtractionRunner({
      provider: { extract },
      concurrency: 1,
      timeoutMs: 60_000,
    });

    await expect(runner.enqueue(job("p", repo))).resolves.toBeUndefined();
    await expect(runner.enqueue(job("q", repo))).resolves.toBeUndefined();
    expect(repo.completeExtractionPass).toHaveBeenCalledTimes(2);
    expect(extract.mock.calls.map(([input]) => input.pass)).toEqual(["scalars", "scalars"]);
  });
});
