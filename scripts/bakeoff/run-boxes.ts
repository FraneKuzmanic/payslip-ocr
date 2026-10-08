/**
 * Bounding-box test: asked for it, can the model say where on the page a value is printed?
 *
 * The model gets every page as an image (the `images` arm of run-input-modes.ts) and returns,
 * for each scalar field, the value, its page and a box. Each box is then judged against the
 * place the OCR words put that same value (.bakeoff/layout/, through ground.ts). A value printed
 * in several places is judged against the nearest one, so a box on any of them counts.
 *
 * This asks only "is the box on the text the model says it read", not whether the value is
 * right: a value the page does not show cannot be judged and is counted apart.
 *
 * Records go to .bakeoff/boxes/. `--summary` judges what is recorded without calling the model.
 */
import { PAYSLIP_FIELDS } from "./field-schema.ts";
import { SYSTEM, complete, imagePart, renderPdfPages, type Usage } from "./model-input.ts";
import { groundValue, layoutGeometry } from "./ground.ts";
import {
  loadExpected,
  sourceBytes,
  readCache,
  writeCache,
  fmtMs,
  type Expected,
} from "./common.ts";

const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const force = process.argv.includes("--force");
const RENDER_DPI = 150;

const BOX_RULES = `Uz svaku vrijednost navedi gdje je ispisana. \`page\` je broj stranice (prva je 1). \`box\` je pravokutnik oko ispisane vrijednosti kao [x0, y0, x1, y1]: lijevi, gornji, desni i donji rub, u tisućinkama širine odnosno visine te stranice (0 do 1000). Pravokutnik obuhvaća samo vrijednost, bez njezine oznake. Kad je vrijednost null, i \`page\` i \`box\` su null.`;

const properties = Object.fromEntries(
  Object.entries(PAYSLIP_FIELDS)
    .filter(([, def]) => def.type !== "array")
    .map(([name, def]) => [
      name,
      {
        type: "object",
        properties: {
          value: { type: ["string", "null"], description: def.description },
          page: { type: ["integer", "null"] },
          box: { type: ["array", "null"], items: { type: "number" } },
        },
        required: ["value", "page", "box"],
        additionalProperties: false,
      },
    ]),
);
const schema = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

interface Located {
  value: string | null;
  page: number | null;
  box: number[] | null;
}
interface BoxRecord {
  latencyMs: number;
  usage: Usage;
  fields: Record<string, Located>;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const area = (r: Rect): number => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
function iou(a: Rect, b: Rect): number {
  const inter = area({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  });
  return inter / (area(a) + area(b) - inter || 1);
}

interface Judged {
  iou: number;
  centreOnText: boolean;
  dx: number;
  dy: number;
  textHeight: number;
}

const median = (xs: number[]): number =>
  xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const share = (n: number, of: number): string =>
  `${String(n).padStart(3)}/${of} ${((n / (of || 1)) * 100).toFixed(0).padStart(3)}%`;

const samples = loadExpected().filter((e) => !only || only.includes(e.sample));

function summary(): void {
  const groups: [string, (e: Expected) => boolean][] = [
    ["all", () => true],
    ["native PDF", (e) => e.sourceKind === "native-pdf"],
    ["image", (e) => e.sourceKind !== "native-pdf"],
  ];
  console.log(
    "\n  sources      boxes   centre on the text   any overlap    IoU >= 0.5   median IoU   median miss, down / across",
  );
  console.log("  " + "-".repeat(104));
  for (const [name, inGroup] of groups) {
    const judged: Judged[] = [];
    let notOnPage = 0;
    let wrongPage = 0;
    for (const e of samples.filter(inGroup)) {
      const record = readCache<BoxRecord>("boxes", e.sample);
      const layout = readCache<Record<string, unknown>>("layout", e.sample);
      if (!record || !layout) continue;
      const { words, pages } = layoutGeometry(layout as never);
      for (const located of Object.values(record.fields)) {
        if (located.value === null || located.box?.length !== 4) continue;
        const printed = groundValue(located.value, words, pages);
        if (!printed.length) {
          notOnPage++;
          continue;
        }
        const onPage = printed.filter((p) => p.page === located.page);
        if (!onPage.length) wrongPage++;
        const [a, b, c, d] = located.box.map((v) => v / 1000) as [number, number, number, number];
        const box = {
          x0: Math.min(a, c),
          y0: Math.min(b, d),
          x1: Math.max(a, c),
          y1: Math.max(b, d),
        };
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2;
        const candidates = (onPage.length ? onPage : printed).map((p): Judged => {
          const xs = p.corners.map((k) => k.x);
          const ys = p.corners.map((k) => k.y);
          const text = {
            x0: Math.min(...xs),
            y0: Math.min(...ys),
            x1: Math.max(...xs),
            y1: Math.max(...ys),
          };
          return {
            iou: iou(box, text),
            centreOnText: cx >= text.x0 && cx <= text.x1 && cy >= text.y0 && cy <= text.y1,
            dx: Math.abs(cx - (text.x0 + text.x1) / 2),
            dy: Math.abs(cy - (text.y0 + text.y1) / 2),
            textHeight: text.y1 - text.y0,
          };
        });
        judged.push(
          candidates.toSorted((p, q) => q.iou - p.iou || p.dx + p.dy - (q.dx + q.dy))[0]!,
        );
      }
    }
    if (!judged.length) continue;
    const n = judged.length;
    const rows = median(judged.map((j) => j.dy)) / (median(judged.map((j) => j.textHeight)) || 1);
    console.log(
      `  ${name.padEnd(11)} ${String(n).padStart(5)}   ${share(judged.filter((j) => j.centreOnText).length, n)}          ` +
        `${share(judged.filter((j) => j.iou > 0).length, n)}   ${share(judged.filter((j) => j.iou >= 0.5).length, n)}   ` +
        `${median(judged.map((j) => j.iou))
          .toFixed(2)
          .padStart(6)}       ` +
        `${(median(judged.map((j) => j.dy)) * 100).toFixed(1)}% (${rows.toFixed(1)} text heights) / ` +
        `${(median(judged.map((j) => j.dx)) * 100).toFixed(1)}% of the page` +
        `   [${notOnPage} values not on the page, ${wrongPage} on another page]`,
    );
  }
  console.log("");
}

if (!process.argv.includes("--summary")) {
  console.log(`\nBoxes from the model: ${samples.length} samples, every page as an image\n`);
  for (const e of samples) {
    if (!force && readCache("boxes", e.sample)) {
      console.log(`  ${e.sample.padEnd(4)} cached`);
      continue;
    }
    try {
      const { bytes, contentType } = sourceBytes(e);
      const content =
        contentType === "application/pdf"
          ? (await renderPdfPages(bytes, RENDER_DPI)).map((p) => imagePart(p, "image/png"))
          : [imagePart(bytes, contentType)];
      const { json, usage, latencyMs } = await complete(
        `${SYSTEM}\n\n${BOX_RULES}`,
        content,
        schema,
      );
      const record: BoxRecord = { latencyMs, usage, fields: json as Record<string, Located> };
      writeCache("boxes", e.sample, record);
      console.log(
        `  ${e.sample.padEnd(4)} ${fmtMs(latencyMs).padStart(6)}  ` +
          `${String(usage.prompt_tokens).padStart(6)} in  ${String(usage.completion_tokens).padStart(5)} out`,
      );
    } catch (err) {
      console.log(`  ${e.sample.padEnd(4)} FAILED  ${(err as Error).message.slice(0, 180)}`);
    }
  }
}
summary();
