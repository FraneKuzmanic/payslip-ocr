/**
 * Challenger, stage 2: read the DI layout markdown, emit the canonical schema as JSON,
 * then re-ground every value against the OCR word geometry.
 *
 * Runs entirely off the cached layout responses, so re-runs cost one LLM call and no OCR.
 */
import { PAYSLIP_FIELDS, SHARED_RULES, type FieldDef } from "./field-schema.ts";
import { loadExpected, readCache, writeCache, requireEnv, fmtMs } from "./common.ts";
import { groundExtraction, layoutGeometry } from "./ground.ts";

const endpoint = requireEnv("AZURE_OPENAI_ENDPOINT").replace(/\/$/, "");
const key = requireEnv("AZURE_OPENAI_KEY");
const deployment = requireEnv("AZURE_OPENAI_DEPLOYMENT");
const apiVersion = requireEnv("AZURE_OPENAI_API_VERSION");
const force = process.argv.includes("--force");

/** FieldDef tree -> strict JSON schema (every property required; null allowed). */
function toJsonSchema(def: FieldDef): Record<string, unknown> {
  if (def.type === "array" && def.items) {
    const props = Object.fromEntries(
      Object.entries(def.items).map(([k, v]) => [
        k,
        { type: ["string", "null"], description: v.description },
      ]),
    );
    return {
      type: "array",
      description: def.description,
      items: {
        type: "object",
        properties: props,
        required: Object.keys(props),
        additionalProperties: false,
      },
    };
  }
  return { type: ["string", "null"], description: def.description };
}

const properties = Object.fromEntries(
  Object.entries(PAYSLIP_FIELDS).map(([k, v]) => [k, toJsonSchema(v)]),
);

const schema = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

const SYSTEM = `Ti si stručnjak za hrvatske obračune plaće. Iz teksta dokumenta izvuci tražena polja.

${SHARED_RULES}`;

async function extract(
  markdown: string,
): Promise<{ fields: Record<string, unknown>; usage: Record<string, number>; latencyMs: number }> {
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `<dokument>\n${markdown}\n</dokument>` },
      ],
      temperature: 0,
      max_tokens: 8000,
      response_format: {
        type: "json_schema",
        json_schema: { name: "HrPayslip", schema, strict: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage: Record<string, number>;
  };
  return {
    fields: JSON.parse(body.choices[0]!.message.content) as Record<string, unknown>,
    usage: body.usage,
    latencyMs: Date.now() - started,
  };
}

console.log(`\nChallenger: DI layout markdown -> ${deployment} -> canonical JSON -> grounding\n`);

const samples = loadExpected();
let ok = 0;
let inTok = 0;
let outTok = 0;
let totalMs = 0;

for (const e of samples) {
  if (!force && readCache("llm", e.sample)) {
    console.log(`  ${e.sample.padEnd(4)} cached`);
    continue;
  }
  const layout = readCache<Record<string, unknown>>("layout", e.sample);
  if (!layout || (layout as { failed?: boolean }).failed) {
    console.log(`  ${e.sample.padEnd(4)} SKIP — no layout cache`);
    continue;
  }
  const markdown =
    (layout as { analyzeResult?: { content?: string } }).analyzeResult?.content ?? "";

  try {
    const { fields, usage, latencyMs } = await extract(markdown);
    const { words, pages } = layoutGeometry(layout as never);
    const grounding = groundExtraction(fields, words, pages);

    writeCache("llm", e.sample, { deployment, apiVersion, latencyMs, usage, fields, grounding });
    ok++;
    inTok += usage["prompt_tokens"] ?? 0;
    outTok += usage["completion_tokens"] ?? 0;
    totalMs += latencyMs;

    const filled = Object.entries(fields).filter(([, v]) => v !== null && !Array.isArray(v)).length;
    const rows = (fields["payComponents"] as unknown[] | null)?.length ?? 0;
    console.log(
      `  ${e.sample.padEnd(4)} ${fmtMs(latencyMs).padStart(7)}  ${String(filled).padStart(2)}/26 scalars  ` +
        `${String(rows).padStart(2)} components  grounded ${String(grounding.grounded).padStart(2)}  ` +
        `${String(usage["total_tokens"]).padStart(5)} tok`,
    );
  } catch (err) {
    console.log(`  ${e.sample.padEnd(4)} FAILED  ${(err as Error).message.slice(0, 180)}`);
  }
}

if (ok) {
  // gpt-4.1 Azure list price, USD per 1M tokens
  const cost = (inTok / 1e6) * 2.0 + (outTok / 1e6) * 8.0;
  console.log(
    `\n${ok} extracted. mean ${fmtMs(totalMs / ok)} per doc | ${inTok} in + ${outTok} out tokens | ~$${cost.toFixed(3)} total (~$${(cost / ok).toFixed(4)}/doc)\n`,
  );
}
