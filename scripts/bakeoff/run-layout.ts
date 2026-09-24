/**
 * Challenger, stage 1: Azure Document Intelligence `prebuilt-layout`.
 *
 * Produces markdown (for the LLM to read) plus per-word polygons (for grounding
 * extracted values back to pixels). Responses are cached under .bakeoff/layout/
 * so stage 2 can be re-run offline without paying for OCR again.
 */
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";
import { loadExpected, sourceBytes, readCache, writeCache, requireEnv, fmtMs } from "./common.ts";

const API_VERSION = "2024-11-30";
const MODEL_ID = "prebuilt-layout";

const endpoint = requireEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
const key = requireEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY");
const force = process.argv.includes("--force");

const client = DocumentIntelligence(endpoint, { key }, { apiVersion: API_VERSION });

const samples = loadExpected();
console.log(`\nDI ${MODEL_ID} (${API_VERSION}) — ${samples.length} samples\n`);

let analysed = 0;
let cached = 0;

for (const e of samples) {
  if (!force && readCache("layout", e.sample)) {
    console.log(`  ${e.sample.padEnd(4)} cached`);
    cached++;
    continue;
  }

  const { bytes } = sourceBytes(e);
  const started = Date.now();

  const initial = await client.path("/documentModels/{modelId}:analyze", MODEL_ID).post({
    contentType: "application/json",
    body: { base64Source: bytes.toString("base64") },
    queryParameters: { outputContentFormat: "markdown", locale: "hr-HR" },
  });

  if (isUnexpected(initial)) {
    const status = initial.status;
    const code = (initial.body as { error?: { code?: string } })?.error?.code ?? "unknown";
    console.log(`  ${e.sample.padEnd(4)} FAILED  HTTP ${status} ${code}`);
    writeCache("layout", e.sample, { failed: true, status, code });
    continue;
  }

  // NB: the poller is thenable — `await getLongRunningPoller(...)` resolves to the
  // final result, not to the poller, and then .pollUntilDone() is missing.
  const poller = getLongRunningPoller(client, initial, { intervalInMs: 1000 });
  const result = (await poller.pollUntilDone()).body as {
    analyzeResult?: {
      content?: string;
      pages?: {
        pageNumber: number;
        width: number;
        height: number;
        unit: string;
        words?: unknown[];
      }[];
      tables?: unknown[];
    };
  };

  const latencyMs = Date.now() - started;
  const ar = result.analyzeResult;
  const pages = ar?.pages ?? [];
  const words = pages.reduce((n, p) => n + (p.words?.length ?? 0), 0);

  writeCache("layout", e.sample, {
    latencyMs,
    apiVersion: API_VERSION,
    modelId: MODEL_ID,
    ...result,
  });
  analysed++;

  console.log(
    `  ${e.sample.padEnd(4)} ${fmtMs(latencyMs).padStart(6)}  ` +
      `${String(pages.length).padStart(2)}p  ${String(words).padStart(5)} words  ` +
      `${String(ar?.tables?.length ?? 0).padStart(2)} tables  ` +
      `${String(ar?.content?.length ?? 0).padStart(6)} md chars  [${pages[0]?.unit ?? "?"}]`,
  );
}

console.log(`\n${analysed} analysed, ${cached} from cache. Raw responses in .bakeoff/layout/\n`);
