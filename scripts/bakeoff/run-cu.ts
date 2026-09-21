/**
 * Primary engine: Azure AI Content Understanding custom analyzer.
 *
 * Creates (once) an analyzer carrying the Croatian payslip field schema, then analyses each
 * sample. `estimateFieldSourceAndConfidence` asks CU to return page + bounding quad +
 * confidence per field — the thing the challenger has to reconstruct by string matching.
 */
import { PAYSLIP_FIELDS, SHARED_RULES, type FieldDef } from "./field-schema.ts";
import { loadExpected, sourceBytes, readCache, writeCache, requireEnv, fmtMs } from "./common.ts";

const endpoint = requireEnv("AZURE_CONTENT_UNDERSTANDING_ENDPOINT").replace(/\/$/, "");
const key = requireEnv("AZURE_CONTENT_UNDERSTANDING_KEY");
const arg = (n: string, d: string): string =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const analyzerId = arg("analyzer", requireEnv("AZURE_CU_ANALYZER_ID"));
const completionModel = arg("model", process.env["AZURE_OPENAI_DEPLOYMENT"] ?? "gpt-4.1");
const cacheKind = arg("cache", "cu");
const apiVersion = requireEnv("AZURE_CU_API_VERSION");
const recreate = process.argv.includes("--recreate");
const force = process.argv.includes("--force") || recreate;

const headers = { "Ocp-Apim-Subscription-Key": key };

/** Our FieldDef tree -> CU fieldSchema. */
function toCuField(def: FieldDef): Record<string, unknown> {
  if (def.type === "array" && def.items) {
    return {
      type: "array",
      method: "extract",
      description: def.description,
      items: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(def.items).map(([k, v]) => [
            k,
            { type: "string", method: "extract", description: v.description },
          ]),
        ),
      },
    };
  }
  return { type: "string", method: "extract", description: def.description };
}

const analyzerDefinition = {
  baseAnalyzerId: "prebuilt-document",
  description: `Hrvatski obračun plaće (Obrazac IP1).\n\n${SHARED_RULES}`,
  // Must name the deployment explicitly: resource-level defaults alone are not enough,
  // the analyzer build resolves models.completion from its own definition.
  models: { completion: completionModel },
  config: {
    returnDetails: true,
    estimateFieldSourceAndConfidence: true,
    enableLayout: true,
    enableOcr: true,
  },
  fieldSchema: {
    name: "HrPayslip",
    description: "Polja hrvatskog obračuna plaće",
    fields: Object.fromEntries(Object.entries(PAYSLIP_FIELDS).map(([k, v]) => [k, toCuField(v)])),
  },
};

async function poll(opUrl: string, label: string, timeoutMs = 300_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(opUrl, { headers });
    const body = (await r.json()) as Record<string, unknown>;
    const status = String(body["status"] ?? "").toLowerCase();
    if (status === "succeeded") return body;
    if (status === "failed" || status === "canceled") {
      throw new Error(`${label} ${status}: ${JSON.stringify(body["error"] ?? body).slice(0, 500)}`);
    }
    if (Date.now() > deadline) throw new Error(`${label} timed out`);
    await new Promise((res) => setTimeout(res, 2000));
  }
}

async function ensureAnalyzer(): Promise<void> {
  const base = `${endpoint}/contentunderstanding/analyzers/${analyzerId}?api-version=${apiVersion}`;

  if (recreate) {
    const del = await fetch(base, { method: "DELETE", headers });
    console.log(`  delete existing analyzer: HTTP ${del.status}`);
  } else {
    const existing = await fetch(base, { headers });
    if (existing.ok) {
      console.log(`  analyzer '${analyzerId}' already exists — reusing (pass --recreate to rebuild)`);
      return;
    }
  }

  console.log(`  creating analyzer '${analyzerId}' with ${Object.keys(PAYSLIP_FIELDS).length} fields...`);
  const res = await fetch(base, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(analyzerDefinition),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create analyzer HTTP ${res.status}: ${text.slice(0, 800)}`);

  const opUrl = res.headers.get("operation-location");
  if (opUrl) await poll(opUrl, "analyzer build");
  console.log(`  analyzer ready`);
}

/** Submit budget before abandoning and retrying — see SUBMIT_STALL note below. */
const SUBMIT_TIMEOUT_MS = 5000;
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
 */
async function submitWithRetry(bytes: Buffer, contentType: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= SUBMIT_TRIES; attempt++) {
    try {
      const res = await fetch(
        `${endpoint}/contentunderstanding/analyzers/${analyzerId}:analyzeBinary?api-version=${apiVersion}`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": contentType },
          body: new Uint8Array(bytes),
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`analyze HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const opUrl = res.headers.get("operation-location");
      if (!opUrl) throw new Error("no operation-location header on analyze response");
      return opUrl;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof DOMException && err.name === "TimeoutError")) throw err;
    }
  }
  throw new Error(`submit stalled on all ${SUBMIT_TRIES} attempts: ${String(lastErr).slice(0, 200)}`);
}

async function analyse(bytes: Buffer, contentType: string): Promise<{ result: unknown; latencyMs: number }> {
  // `:analyze` takes JSON ({url: ...}) only; `:analyzeBinary` is the one that accepts raw
  // bytes, which is what we need for local files that must not be published anywhere.
  const started = Date.now();
  const opUrl = await submitWithRetry(bytes, contentType);
  const done = await poll(opUrl, "analyze");
  return { result: done, latencyMs: Date.now() - started };
}

console.log(`\nContent Understanding (${apiVersion}) — analyzer '${analyzerId}'\n`);
await ensureAnalyzer();
console.log("");

const samples = loadExpected();
let ok = 0;
let failed = 0;

for (const e of samples) {
  if (!force && readCache(cacheKind, e.sample)) {
    console.log(`  ${e.sample.padEnd(4)} cached`);
    continue;
  }
  const { bytes, contentType } = sourceBytes(e);
  try {
    const { result, latencyMs } = await analyse(bytes, contentType);
    writeCache(cacheKind, e.sample, { latencyMs, apiVersion, analyzerId, ...(result as object) });
    const contents = (result as { result?: { contents?: { fields?: Record<string, unknown> }[] } })
      .result?.contents ?? [];
    const fields = contents[0]?.fields ?? {};
    const filled = Object.values(fields).filter(
      (f) => f && (f as { valueString?: unknown }).valueString != null,
    ).length;
    console.log(
      `  ${e.sample.padEnd(4)} ${fmtMs(latencyMs).padStart(7)}  ${String(Object.keys(fields).length).padStart(2)} fields returned, ${String(filled).padStart(2)} non-null`,
    );
    ok++;
  } catch (err) {
    console.log(`  ${e.sample.padEnd(4)} FAILED  ${(err as Error).message.slice(0, 200)}`);
    failed++;
  }
}

console.log(`\n${ok} analysed, ${failed} failed. Raw responses in .bakeoff/${cacheKind}/\n`);
