/**
 * Input-mode experiment: does the model read a payslip better as OCR text or as the document?
 *
 * One model, one field schema, one set of rules, one request shape. Only the form the document
 * takes in the user message changes:
 *
 *   ocr     DI layout markdown as text (the challenger's input, from .bakeoff/layout/)
 *   images  every page as an image; a PDF's pages are rendered first, so nothing but pixels
 *   files   the source file as it is: a PDF as a file part, an image as an image
 *   crops   every page as overlapping horizontal bands, so the service sees it about twice as large
 *
 * For an image source `images` and `files` send the same request. For a PDF they differ: the
 * service reads a PDF file part as its text layer plus a picture of each page.
 *
 * The arms run interleaved, sample by sample, so one day's generation rate applies to them all.
 * Records go to .bakeoff/input-modes/<arm>-r<rep>/ and are scored with
 * `npm run score -- input-modes/<arm>-r<rep>`. `--summary` prints tokens, latency and cost.
 */
import { PAYSLIP_FIELDS, type FieldDef } from "./field-schema.ts";
import {
  SYSTEM,
  complete,
  imagePart,
  pageBands,
  renderPdfPages,
  type Part,
  type Usage,
} from "./model-input.ts";
import {
  loadExpected,
  sourceBytes,
  readCache,
  writeCache,
  fmtMs,
  type Expected,
} from "./common.ts";

const ARMS = ["ocr", "images", "files", "crops"] as const;
type Arm = (typeof ARMS)[number];

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const reps = Number(arg("reps") ?? 3);
const only = arg("only")?.split(",");
const force = process.argv.includes("--force");
const kind = (arm: Arm, rep: number): string => `input-modes/${arm}-r${rep}`;

/** PDF pages are rendered at this resolution; the service scales an image down as it needs. */
const RENDER_DPI = 150;
/** For `crops`: an A4 page 1,654 px across, so a band is not scaled up by the service. */
const CROPS_DPI = 200;

const CROPS_NOTE =
  "Dokument je poslan kao niz vodoravnih isječaka, odozgo prema dolje, stranicu po stranicu. " +
  "Susjedni isječci se malo preklapaju: redak koji se vidi u dva isječka je isti redak i navodi se jednom.";

// USD. gpt-4.1 Azure list price per 1M tokens, and DI prebuilt-layout per page.
const PRICE = { input: 2.0, cachedInput: 0.5, output: 8.0, layoutPage: 0.01 };

/** FieldDef tree -> strict JSON schema (every property required; null allowed). As run-llm.ts. */
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

/** The user message for one arm, and what it was built from. */
async function userContent(
  arm: Arm,
  e: Expected,
): Promise<{ content: string | Part[]; input: string; extraMs: number; extraUsd: number } | null> {
  if (arm === "ocr") {
    const layout = readCache<{
      failed?: boolean;
      latencyMs?: number;
      analyzeResult?: { content?: string; pages?: unknown[] };
    }>("layout", e.sample);
    if (!layout || layout.failed) return null;
    return {
      content: `<dokument>\n${layout.analyzeResult?.content ?? ""}\n</dokument>`,
      input: "layout-markdown",
      // The OCR call is part of this arm: its recorded time and its price per page.
      extraMs: layout.latencyMs ?? 0,
      extraUsd: (layout.analyzeResult?.pages?.length ?? e.pageCount) * PRICE.layoutPage,
    };
  }
  const { bytes, contentType } = sourceBytes(e);
  if (arm === "crops") {
    const started = Date.now();
    const pages =
      contentType === "application/pdf" ? await renderPdfPages(bytes, CROPS_DPI) : [bytes];
    const bands = (await Promise.all(pages.map(pageBands))).flat();
    return {
      content: [{ type: "text", text: CROPS_NOTE }, ...bands.map((b) => imagePart(b, "image/png"))],
      input: `${bands.length}-bands`,
      extraMs: Date.now() - started,
      extraUsd: 0,
    };
  }
  if (contentType !== "application/pdf") {
    return { content: [imagePart(bytes, contentType)], input: "image", extraMs: 0, extraUsd: 0 };
  }
  if (arm === "files") {
    const file_data = `data:application/pdf;base64,${bytes.toString("base64")}`;
    return {
      content: [{ type: "file", file: { filename: e.sourceFile, file_data } }],
      input: "pdf-file",
      extraMs: 0,
      extraUsd: 0,
    };
  }
  const started = Date.now();
  const pages = await renderPdfPages(bytes, RENDER_DPI);
  return {
    content: pages.map((p) => imagePart(p, "image/png")),
    input: "pdf-page-images",
    extraMs: Date.now() - started,
    extraUsd: 0,
  };
}

interface Record_ {
  arm: Arm;
  rep: number;
  input: string;
  sourceKind: string;
  latencyMs: number;
  extraMs: number;
  extraUsd: number;
  usage: Usage;
  fields: Record<string, unknown>;
}

const usd = (r: Record_): number => {
  const cached = r.usage.prompt_tokens_details?.cached_tokens ?? 0;
  return (
    ((r.usage.prompt_tokens - cached) * PRICE.input +
      cached * PRICE.cachedInput +
      r.usage.completion_tokens * PRICE.output) /
      1e6 +
    r.extraUsd
  );
};

const samples = loadExpected().filter((e) => !only || only.includes(e.sample));

const quantile = (xs: number[], q: number): number =>
  xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function summary(): void {
  const groups: [string, (e: Expected) => boolean][] = [
    ["all", () => true],
    ["native PDF", (e) => e.sourceKind === "native-pdf"],
    ["image", (e) => e.sourceKind !== "native-pdf"],
  ];
  console.log(
    "\n  arm     sources      n   input tok (cached)   output tok   latency p50 / p90   $ per doc",
  );
  console.log("  " + "-".repeat(88));
  let total = 0;
  for (const arm of ARMS) {
    for (const [name, inGroup] of groups) {
      const rs: Record_[] = [];
      for (let rep = 1; rep <= reps; rep++)
        for (const e of samples.filter(inGroup)) {
          const r = readCache<Record_>(kind(arm, rep), e.sample);
          if (r) rs.push(r);
        }
      if (!rs.length) continue;
      if (name === "all") total += rs.reduce((a, r) => a + usd(r) - r.extraUsd, 0);
      const ms = rs.map((r) => r.latencyMs + r.extraMs);
      const cached = rs.map((r) => r.usage.prompt_tokens_details?.cached_tokens ?? 0);
      console.log(
        `  ${arm.padEnd(7)} ${name.padEnd(11)} ${String(rs.length).padStart(2)}   ` +
          `${String(
            Math.round(
              quantile(
                rs.map((r) => r.usage.prompt_tokens),
                0.5,
              ),
            ),
          ).padStart(6)} ` +
          `(${String(Math.round(mean(cached))).padStart(5)})      ` +
          `${String(
            Math.round(
              quantile(
                rs.map((r) => r.usage.completion_tokens),
                0.5,
              ),
            ),
          ).padStart(5)}        ` +
          `${fmtMs(quantile(ms, 0.5)).padStart(6)} / ${fmtMs(quantile(ms, 0.9)).padStart(6)}     ` +
          `${mean(rs.map(usd)).toFixed(4)}`,
      );
    }
  }
  console.log(
    `\n  Input and output tokens are medians per document; cached is the mean. Latency and cost\n` +
      `  for 'ocr' include the layout call (its recorded time, $${PRICE.layoutPage}/page).\n` +
      `  Estimated spend on the recorded model calls: $${total.toFixed(2)}\n`,
  );
}

if (process.argv.includes("--summary")) {
  summary();
} else {
  console.log(`\nInput modes: ${ARMS.join(", ")} x ${reps} run(s) x ${samples.length} samples\n`);
  for (let rep = 1; rep <= reps; rep++) {
    for (const e of samples) {
      for (const arm of ARMS) {
        const tag = `  r${rep} ${e.sample.padEnd(4)} ${arm.padEnd(7)}`;
        if (!force && readCache(kind(arm, rep), e.sample)) {
          console.log(`${tag} cached`);
          continue;
        }
        try {
          const built = await userContent(arm, e);
          if (!built) {
            console.log(`${tag} SKIP: no layout cache`);
            continue;
          }
          const { json: fields, usage, latencyMs } = await complete(SYSTEM, built.content, schema);
          const record: Record_ = {
            arm,
            rep,
            input: built.input,
            sourceKind: e.sourceKind,
            latencyMs,
            extraMs: built.extraMs,
            extraUsd: built.extraUsd,
            usage,
            fields,
          };
          writeCache(kind(arm, rep), e.sample, record);
          console.log(
            `${tag} ${fmtMs(latencyMs + built.extraMs).padStart(6)}  ` +
              `${String(usage.prompt_tokens).padStart(6)} in  ` +
              `${String(usage.completion_tokens).padStart(5)} out  $${usd(record).toFixed(4)}  ${built.input}`,
          );
        } catch (err) {
          console.log(`${tag} FAILED  ${(err as Error).message.slice(0, 180)}`);
        }
      }
    }
  }
  summary();
}
