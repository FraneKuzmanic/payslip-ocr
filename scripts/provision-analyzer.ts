/**
 * Provision the Content Understanding analyzers, repeatably, and check they have not drifted.
 *
 *   npm run provision:analyzer              register defaults if missing; create each pass
 *                                           analyzer if missing; otherwise verify it matches
 *   npm run provision:analyzer -- --replace delete and recreate a drifted analyzer
 *
 * Two one-time actions live here so they cannot be lost to a portal click:
 * - `PATCH /contentunderstanding/defaults`, the per-resource model registration;
 * - one analyzer per extraction pass (Task 05 D5), `<AZURE_CU_ANALYZER_ID>_scalars` and
 *   `<AZURE_CU_ANALYZER_ID>_tables`, built from the same definitions the API calls.
 *
 * The single-pass analyzer `<AZURE_CU_ANALYZER_ID>` itself stays deployed, untouched and no longer
 * managed here: the product no longer calls it, but the single-pass recordings every two-pass
 * figure is compared against came from it.
 *
 * A replaced analyzer invalidates the recordings made with it: re-record before scoring.
 * The key is never printed.
 */
import { isDeepStrictEqual } from "node:util";
import "dotenv/config";
import {
  ANALYZER_DESCRIPTION,
  analyzerIdFor,
  buildAnalyzerDefinition,
} from "../api/src/providers/document-extraction/content-understanding/analyzer.ts";
import {
  EXTRACTION_PASSES,
  type ExtractionPass,
} from "../api/src/providers/document-extraction/types.ts";

const EMBEDDING_MODEL = "text-embedding-3-large";

const endpoint = requireEnv("AZURE_CONTENT_UNDERSTANDING_ENDPOINT").replace(/\/$/, "");
const key = requireEnv("AZURE_CONTENT_UNDERSTANDING_KEY");
const analyzerId = requireEnv("AZURE_CU_ANALYZER_ID");
const apiVersion = requireEnv("AZURE_CU_API_VERSION");
const completionModel = process.env["AZURE_OPENAI_DEPLOYMENT"]?.trim() || "gpt-4.1";
const replace = process.argv.includes("--replace");
const headers = { "Ocp-Apim-Subscription-Key": key };

console.log(`\nContent Understanding (${apiVersion}) — analyzer family '${analyzerId}'\n`);

await ensureDefaults();
let drifted = false;
for (const pass of EXTRACTION_PASSES) {
  if (await ensureAnalyzer(pass)) drifted = true;
}
process.exit(drifted ? 1 : 0);

async function ensureDefaults(): Promise<void> {
  const url = `${endpoint}/contentunderstanding/defaults?api-version=${apiVersion}`;
  const response = await fetch(url, { headers });
  if (!response.ok) fail(`GET defaults: HTTP ${response.status}`);
  const current =
    ((await response.json()) as { modelDeployments?: Record<string, string> }).modelDeployments ??
    {};

  const missing = [completionModel, EMBEDDING_MODEL].filter((model) => !(model in current));
  console.log(`  defaults: ${Object.keys(current).toSorted().join(", ") || "(none)"}`);
  if (missing.length === 0) return;

  // Merged with what exists: a registration someone else relies on is never dropped.
  const modelDeployments = { ...current, ...Object.fromEntries(missing.map((m) => [m, m])) };
  const patch = await fetch(url, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/merge-patch+json" },
    body: JSON.stringify({ modelDeployments }),
  });
  if (!patch.ok) fail(`PATCH defaults: HTTP ${patch.status}`);
  console.log(`  registered defaults: ${missing.join(", ")}`);
}

/** Returns true when the deployed analyzer differs from the code and was left alone. */
async function ensureAnalyzer(pass: ExtractionPass): Promise<boolean> {
  const id = analyzerIdFor(analyzerId, pass);
  const url = `${endpoint}/contentunderstanding/analyzers/${id}?api-version=${apiVersion}`;
  const existing = await fetch(url, { headers });

  if (existing.status === 404) {
    await create(url, id, pass);
    return false;
  }
  if (!existing.ok) fail(`GET analyzer '${id}': HTTP ${existing.status}`);

  const deployed = (await existing.json()) as {
    description?: string;
    fieldSchema?: { fields?: Record<string, unknown> };
  };
  const expected = buildAnalyzerDefinition(completionModel, pass);
  const deployedFields = deployed.fieldSchema?.fields ?? {};
  const differing = [
    ...(deployed.description === ANALYZER_DESCRIPTION ? [] : ["(description)"]),
    ...[...new Set([...Object.keys(deployedFields), ...Object.keys(expected.fieldSchema.fields)])]
      .filter(
        (name) =>
          // Key order is not compared: isDeepStrictEqual checks own properties, not their order.
          !isDeepStrictEqual(deployedFields[name], expected.fieldSchema.fields[name]),
      )
      .toSorted(),
  ];

  if (differing.length === 0) {
    console.log(`  analyzer '${id}' matches the code`);
    return false;
  }

  console.log(`  analyzer '${id}' DIFFERS from the code: ${differing.join(", ")}`);
  if (!replace) {
    console.log(
      "  re-run with --replace to rebuild it (this invalidates every two-pass recording set)",
    );
    return true;
  }

  const deleted = await fetch(url, { method: "DELETE", headers });
  if (!deleted.ok) fail(`DELETE analyzer '${id}': HTTP ${deleted.status}`);
  await create(url, id, pass);
  console.log(
    "  !! two-pass recordings in .bakeoff/ are now stale: re-record them before running score:extraction",
  );
  return false;
}

async function create(url: string, id: string, pass: ExtractionPass): Promise<void> {
  console.log(`  creating analyzer '${id}' (completion model '${completionModel}')...`);
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(buildAnalyzerDefinition(completionModel, pass)),
  });
  if (!response.ok) fail(`PUT analyzer '${id}': HTTP ${response.status}`);
  const operationUrl = response.headers.get("operation-location");
  if (operationUrl) await poll(operationUrl);
  console.log("  analyzer ready");
}

async function poll(operationUrl: string): Promise<void> {
  const deadline = Date.now() + 300_000;
  for (;;) {
    const response = await fetch(operationUrl, { headers });
    const status = String(((await response.json()) as { status?: unknown }).status ?? "");
    if (status.toLowerCase() === "succeeded") return;
    if (/^(failed|canceled)$/i.test(status)) fail(`analyzer build ${status}`);
    if (Date.now() > deadline) fail("analyzer build timed out");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`missing ${name} in .env`);
  return value;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(2);
}
