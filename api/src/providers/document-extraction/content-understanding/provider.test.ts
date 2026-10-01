import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractionError } from "../types.js";
import { ContentUnderstandingProvider } from "./provider.js";

const OPERATION_URL = "https://cu.invalid/contentunderstanding/analyzerResults/op-1?api-version=x";

type Step = (url: string, init: RequestInit | undefined) => Promise<Response>;

/** Scripts `fetch` as a queue: each call consumes the next step. */
function stubFetch(steps: Step[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const step = steps.shift();
    if (step === undefined) throw new Error(`unexpected fetch ${url}`);
    return step(url, init);
  });
  vi.stubGlobal("fetch", fetchStub);
  return calls;
}

/**
 * Scripts `fetch` per analyzer (Task 17): the scalars pass runs two analyses at once, so their
 * calls interleave in no fixed order. A submit is routed by its analyzer's role, and a poll by the
 * operation URL `acceptedFor` gave that role.
 */
function stubFetchByAnalyzer(steps: Record<string, Step[]>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const role =
      /_(\w+):analyzeBinary/.exec(url)?.[1] ?? /analyzerResults\/op-(\w+)\?/.exec(url)?.[1];
    const step = role === undefined ? undefined : steps[role]?.shift();
    if (step === undefined) throw new Error(`unexpected fetch ${url}`);
    return step(url, init);
  });
  vi.stubGlobal("fetch", fetchStub);
  return calls;
}

const acceptedFor =
  (role: string): Step =>
  () =>
    Promise.resolve(
      new Response(null, {
        status: 202,
        headers: {
          "operation-location": `https://cu.invalid/contentunderstanding/analyzerResults/op-${role}?api-version=x`,
        },
      }),
    );

const accepted: Step = () =>
  Promise.resolve(
    new Response(null, { status: 202, headers: { "operation-location": OPERATION_URL } }),
  );

/** What the service does from the client's side when the submit budget runs out. */
const stalled: Step = () => Promise.reject(new DOMException("stalled", "TimeoutError"));

/** A request the service sits on: it ends only when its signal aborts. */
const held =
  (signals: AbortSignal[]): Step =>
  (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error("the request carries no signal");
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason));
    });

const json =
  (body: unknown, status = 200): Step =>
  () =>
    Promise.resolve(Response.json(body, { status }));

const httpError =
  (status: number): Step =>
  () =>
    Promise.resolve(new Response("", { status, headers: { "x-ms-error-code": "SomeCode" } }));

const succeeded = (markdown = "# OBRAČUN PLAĆE", fields: Record<string, unknown> = {}) =>
  json({
    id: "op-1",
    status: "Succeeded",
    result: {
      contents: [
        {
          markdown,
          fields: {
            netoPlaca: { type: "string", valueString: "2.298,97", confidence: 0.9 },
            ...fields,
          },
          pages: [{ pageNumber: 1, words: [{ content: "NETO" }, { content: "2.298,97" }] }],
        },
      ],
    },
  });

function provider(overrides: { submitTimeoutMs?: number } = {}) {
  return new ContentUnderstandingProvider({
    endpoint: "https://cu.invalid",
    key: "test-key",
    analyzerFamilyId: "testAnalyzer",
    apiVersion: "2025-11-01",
    pollIntervalMs: 1,
    ...overrides,
  });
}

/** Reads a streamed request body the way fetch would, optionally pausing between chunks. */
async function drain(body: BodyInit | null | undefined, pauseMs = 0): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as ReadableStream<Uint8Array>) {
    chunks.push(chunk);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return Buffer.concat(chunks);
}

const input = (
  signal: AbortSignal = new AbortController().signal,
  pass: "scalars" | "tables" = "tables",
) => ({
  bytes: Buffer.from("%PDF-1.7"),
  contentType: "application/pdf" as const,
  signal,
  pass,
});

async function failure(promise: Promise<unknown>): Promise<ExtractionError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ExtractionError);
  return error as ExtractionError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// One analysis, from submit to result. These run on the tables pass, which is a single analysis;
// the scalars pass runs two of the same at once (Task 17) and has its own block below.
describe("ContentUnderstandingProvider", () => {
  const rows = {
    payComponents: {
      type: "array",
      valueArray: [
        {
          valueObject: {
            naziv: { valueString: "REDOVAN RAD", confidence: 0.9 },
            iznos: { valueString: "1.200,00", confidence: 0.9 },
          },
        },
      ],
    },
  };

  it("submits the bytes, polls to success and returns canonical fields", async () => {
    const calls = stubFetch([accepted, json({ status: "Running" }), succeeded("# page", rows)]);

    const result = await provider().extract(input());

    expect(result.fields.payComponents?.[0]?.iznos).toBe("1200.00");
    expect(result.metadata).toMatchObject({
      provider: "content-understanding",
      modelId: "testAnalyzer_tables",
      apiVersion: "2025-11-01",
      submitAttempts: 1,
      unreadableFields: [],
      fields: { "payComponents.0.iznos": { confidence: 0.9, source: "model" } },
    });
    expect(result.raw).toMatchObject({ status: "Succeeded" });

    const submit = calls[0];
    expect(submit?.url).toBe(
      "https://cu.invalid/contentunderstanding/analyzers/testAnalyzer_tables:analyzeBinary?api-version=2025-11-01",
    );
    expect(submit?.init?.method).toBe("POST");
    expect(submit?.init?.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": "test-key",
      "Content-Type": "application/pdf",
    });
    expect(calls[1]?.url).toBe(OPERATION_URL);
  });

  it("resubmits after a stalled submit and counts the attempts", async () => {
    stubFetch([stalled, accepted, succeeded()]);

    const result = await provider().extract(input());

    expect(result.metadata.submitAttempts).toBe(2);
  });

  it("sends the exact bytes, with their length, as a streamed body", async () => {
    let received: Buffer = Buffer.alloc(0);
    let headers: HeadersInit | undefined;
    stubFetch([
      async (_url, init) => {
        headers = init?.headers;
        received = await drain(init?.body);
        return accepted(_url, init);
      },
      succeeded(),
    ]);
    const bytes = Buffer.alloc(200_000, 7);

    await provider().extract({ ...input(), bytes });

    expect(received.equals(bytes)).toBe(true);
    expect(headers).toMatchObject({ "Content-Length": "200000" });
  });

  it("does not count a slow upload against the stall budget", async () => {
    stubFetch([
      async (_url, init) => {
        // Four 64 KB chunks at 40 ms each: the upload alone outlasts the 50 ms budget.
        await drain(init?.body, 40);
        return accepted(_url, init);
      },
      succeeded(),
    ]);

    const result = await provider({ submitTimeoutMs: 50 }).extract({
      ...input(),
      bytes: Buffer.alloc(200_000),
    });

    expect(result.metadata.submitAttempts).toBe(1);
  });

  it("abandons a submit the service sits on after the body has arrived, and resubmits", async () => {
    const heldOpen: Step = async (_url, init) => {
      await drain(init?.body);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    };
    stubFetch([heldOpen, accepted, succeeded()]);

    const result = await provider({ submitTimeoutMs: 50 }).extract(input());

    expect(result.metadata.submitAttempts).toBe(2);
  });

  it("gives up as provider_unavailable after four stalled submits", async () => {
    stubFetch([stalled, stalled, stalled, stalled]);

    const error = await failure(provider().extract(input()));

    expect(error.reason).toBe("provider_unavailable");
    expect(error.retryable).toBe(true);
  });

  it.each([
    [400, "provider_rejected", false],
    [413, "provider_rejected", false],
    [401, "provider_unavailable", true],
    [404, "provider_unavailable", true],
    [429, "provider_unavailable", true],
    [503, "provider_unavailable", true],
  ] as const)("classifies a submit HTTP %i as %s", async (status, reason, retryable) => {
    stubFetch([httpError(status)]);

    const error = await failure(provider().extract(input()));

    expect(error.reason).toBe(reason);
    expect(error.retryable).toBe(retryable);
  });

  it("classifies a network error as provider_unavailable", async () => {
    stubFetch([() => Promise.reject(new TypeError("fetch failed"))]);

    expect((await failure(provider().extract(input()))).reason).toBe("provider_unavailable");
  });

  it.each(["Failed", "Canceled"])(
    "classifies an operation %s as provider_unavailable",
    async (status) => {
      stubFetch([accepted, json({ status, error: { code: "InternalServerError", message: "x" } })]);

      expect((await failure(provider().extract(input()))).reason).toBe("provider_unavailable");
    },
  );

  it("classifies a poll HTTP error as provider_unavailable", async () => {
    stubFetch([accepted, httpError(500)]);

    expect((await failure(provider().extract(input()))).reason).toBe("provider_unavailable");
  });

  it("classifies a succeeded body the mapper cannot read as provider_unavailable", async () => {
    stubFetch([accepted, json({ status: "Succeeded", result: {} })]);

    expect((await failure(provider().extract(input()))).reason).toBe("provider_unavailable");
  });

  describe("the scalars pass: two analyses at once (Task 17 D1, D5)", () => {
    const scalars = (signal?: AbortSignal) => input(signal, "scalars");
    const header = (markdown = "# OBRAČUN PLAĆE") =>
      succeeded(markdown, {
        employerName: { type: "string", valueString: "Tvrtka d.o.o.", confidence: 0.8 },
        // Not the header's field: the reconciliation part owns it.
        netoPlaca: { type: "string", valueString: "1,00", confidence: 0.9 },
      });
    const noValue = (markdown = "# page") => succeeded(markdown, { netoPlaca: { type: "string" } });

    it("submits to both parts' analyzers and merges the fields each owns", async () => {
      const calls = stubFetchByAnalyzer({
        header: [acceptedFor("header"), json({ status: "Running" }), header()],
        reconciliation: [acceptedFor("reconciliation"), succeeded()],
      });

      const result = await provider().extract(scalars());

      expect(
        calls
          .map((call) => /analyzers\/(\w+):analyzeBinary/.exec(call.url)?.[1])
          .filter((id) => id !== undefined)
          .toSorted(),
      ).toEqual(["testAnalyzer_header", "testAnalyzer_reconciliation"]);
      expect(result.fields.employerName).toBe("Tvrtka d.o.o.");
      expect(result.fields.netoPlaca).toBe("2298.97");
      expect(result.fields).toHaveProperty("employeeName", null);
      expect(result.fields).not.toHaveProperty("payComponents");
      expect(result.metadata).toMatchObject({
        modelId: "testAnalyzer_header+testAnalyzer_reconciliation",
        submitAttempts: 1,
        fields: {
          employerName: { confidence: 0.8, source: "model" },
          netoPlaca: { confidence: 0.9, source: "model" },
        },
      });
      // The pass's upload ends at the later `202`; the rest of its latency is analysis.
      const { latencyMs, uploadMs, analyzeMs } = result.metadata;
      expect(uploadMs).toBeGreaterThanOrEqual(0);
      expect(analyzeMs).toBeGreaterThanOrEqual(0);
      expect(latencyMs).toBe((uploadMs ?? NaN) + (analyzeMs ?? NaN));
    });

    it("retains both bodies verbatim, by part", async () => {
      stubFetchByAnalyzer({
        header: [acceptedFor("header"), header()],
        reconciliation: [acceptedFor("reconciliation"), succeeded()],
      });

      const { raw, metadata } = await provider().extract(scalars());

      expect(metadata).not.toHaveProperty("rowOrder");
      expect(Object.keys(raw as object)).toEqual(["header", "reconciliation"]);
      expect(raw).toMatchObject({
        header: { result: { contents: [{ fields: { employerName: {} } }] } },
        reconciliation: { result: { contents: [{ fields: { netoPlaca: {} } }] } },
      });
    });

    it("reports the larger of the parts' submit attempts", async () => {
      stubFetchByAnalyzer({
        header: [stalled, acceptedFor("header"), header()],
        reconciliation: [acceptedFor("reconciliation"), succeeded()],
      });

      const result = await provider().extract(scalars());

      expect(result.metadata.submitAttempts).toBe(2);
    });

    it("fails with the failing part's reason and aborts the other part", async () => {
      const signals: AbortSignal[] = [];
      stubFetchByAnalyzer({ header: [httpError(400)], reconciliation: [held(signals)] });

      const error = await failure(provider().extract(scalars()));

      expect(error.reason).toBe("provider_rejected");
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
    });

    it("stops both parts when the whole-analysis signal aborts", async () => {
      const controller = new AbortController();
      const signals: AbortSignal[] = [];
      stubFetchByAnalyzer({ header: [held(signals)], reconciliation: [held(signals)] });

      const pending = failure(provider().extract(scalars(controller.signal)));
      controller.abort();

      expect((await pending).reason).toBe("provider_unavailable");
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });

    it("classifies blank markdown in both parts as unreadable_document, not retryable", async () => {
      stubFetchByAnalyzer({
        header: [acceptedFor("header"), header("   ")],
        reconciliation: [acceptedFor("reconciliation"), succeeded("   ")],
      });

      const error = await failure(provider().extract(scalars()));

      expect(error.reason).toBe("unreadable_document");
      expect(error.retryable).toBe(false);
    });

    it("classifies text with no extracted value in either part as unreadable_document", async () => {
      stubFetchByAnalyzer({
        header: [acceptedFor("header"), noValue()],
        reconciliation: [acceptedFor("reconciliation"), noValue()],
      });

      expect((await failure(provider().extract(scalars()))).reason).toBe("unreadable_document");
    });

    it("keeps a payslip readable when only one part returns values", async () => {
      stubFetchByAnalyzer({
        header: [acceptedFor("header"), noValue()],
        reconciliation: [acceptedFor("reconciliation"), succeeded()],
      });

      const { fields } = await provider().extract(scalars());

      expect(fields.netoPlaca).toBe("2298.97");
      expect(fields.employerName).toBeNull();
    });

    it("classifies a part the mapper cannot read as provider_unavailable", async () => {
      stubFetchByAnalyzer({
        header: [acceptedFor("header"), json({ status: "Succeeded", result: {} })],
        reconciliation: [acceptedFor("reconciliation"), succeeded()],
      });

      expect((await failure(provider().extract(scalars()))).reason).toBe("provider_unavailable");
    });
  });

  describe("the tables pass (Task 05 D9)", () => {
    it("analyses with the tables analyzer and returns only the table keys", async () => {
      const calls = stubFetch([accepted, succeeded("# page", rows)]);

      const result = await provider().extract(input());

      expect(calls[0]?.url).toContain("/analyzers/testAnalyzer_tables:analyzeBinary");
      expect(result.metadata.modelId).toBe("testAnalyzer_tables");
      expect(result.metadata.rowOrder).toBe("printed");
      expect(Object.keys(result.fields).toSorted()).toEqual([
        "neoporeziviPrimici",
        "obustave",
        "payComponents",
      ]);
      expect(result.fields.payComponents?.[0]).toMatchObject({
        naziv: "REDOVAN RAD",
        iznos: "1200.00",
      });
    });

    describe("a pay-component row that repeats bruto plaća (Task 17 D14)", () => {
      const withTotal = {
        payComponents: {
          type: "array",
          valueArray: [
            {
              valueObject: {
                naziv: { valueString: "UKUPNO BRUTO" },
                iznos: { valueString: "1.200,00" },
              },
            },
            ...rows.payComponents.valueArray,
          ],
        },
      };

      it("is left out once the scalars pass's bruto plaća says so, and recorded", async () => {
        stubFetch([accepted, succeeded("# page", withTotal)]);

        const result = await provider().extract({
          ...input(),
          brutoPlaca: Promise.resolve("1200.00"),
        });

        expect(result.fields.payComponents?.map((row) => row.naziv)).toEqual(["REDOVAN RAD"]);
        expect(Object.keys(result.metadata.fields)).toEqual([
          "payComponents.0.naziv",
          "payComponents.0.iznos",
        ]);
        expect(result.metadata.totalRow).toBe(0);
        // The retained body is verbatim: the row is still in it.
        expect(result.raw).toMatchObject({
          result: { contents: [{ fields: { payComponents: { valueArray: [{}, {}] } } }] },
        });
      });

      it.each([
        ["bruto plaća was not read", Promise.resolve(null)],
        ["the runner gives none", undefined],
        ["bruto plaća is another amount", Promise.resolve("1500.00")],
      ])("stays when %s, with no mark", async (_case, brutoPlaca) => {
        stubFetch([accepted, succeeded("# page", withTotal)]);

        const result = await provider().extract({
          ...input(),
          ...(brutoPlaca === undefined ? {} : { brutoPlaca }),
        });

        expect(result.fields.payComponents).toHaveLength(2);
        expect(result.metadata).not.toHaveProperty("totalRow");
      });
    });

    it("treats a page with text and three empty tables as a result, not a failure", async () => {
      stubFetch([accepted, succeeded("# page")]);

      const { fields } = await provider().extract(input());

      expect(fields).toEqual({ payComponents: [], obustave: [], neoporeziviPrimici: [] });
    });

    it("classifies blank markdown as unreadable_document", async () => {
      stubFetch([accepted, succeeded("  ", rows)]);

      const error = await failure(provider().extract(input()));

      expect(error.reason).toBe("unreadable_document");
    });
  });

  it("stops promptly when the whole-analysis signal aborts mid-poll", async () => {
    const controller = new AbortController();
    const running: Step = () => {
      controller.abort();
      return Promise.resolve(Response.json({ status: "Running" }));
    };
    const calls = stubFetch([accepted, running]);

    const error = await failure(provider().extract(input(controller.signal)));

    expect(error.reason).toBe("provider_unavailable");
    expect(calls).toHaveLength(2);
  });

  it("makes no further submit once the whole-analysis signal has aborted", async () => {
    const controller = new AbortController();
    const calls = stubFetch([
      () => {
        controller.abort();
        return Promise.reject(new DOMException("aborted", "AbortError"));
      },
    ]);

    const error = await failure(provider().extract(input(controller.signal)));

    expect(error.reason).toBe("provider_unavailable");
    expect(calls).toHaveLength(1);
  });
});
