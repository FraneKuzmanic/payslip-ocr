/**
 * What the input-mode experiments share: the request to the completion model, and the ways a
 * document is turned into message parts. Used by run-input-modes.ts and run-boxes.ts.
 */
import { join } from "node:path";
// Not a dependency of this package: pdfjs-dist installs it for rendering in Node.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SHARED_RULES } from "./field-schema.ts";
import { ROOT, requireEnv } from "./common.ts";

// run-llm.ts says "Iz teksta dokumenta"; one wording has to serve text, images and files.
export const SYSTEM = `Ti si stručnjak za hrvatske obračune plaće. Iz dokumenta izvuci tražena polja.

${SHARED_RULES}`;

export type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } }
  | { type: "file"; file: { filename: string; file_data: string } };

export const imagePart = (bytes: Buffer, contentType: string): Part => ({
  type: "image_url",
  image_url: { url: `data:${contentType};base64,${bytes.toString("base64")}`, detail: "high" },
});

/** Each page of a PDF as a PNG. The service scales an image down as it needs. */
export async function renderPdfPages(bytes: Buffer, dpi: number): Promise<Buffer[]> {
  const pdfjs = join(ROOT, "node_modules", "pdfjs-dist");
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: join(pdfjs, "standard_fonts") + "/",
    cMapUrl: join(pdfjs, "cmaps") + "/",
    cMapPacked: true,
  }).promise;
  const pages: Buffer[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const { canvas } = doc.canvasFactory.create(viewport.width, viewport.height) as {
      canvas: { toBuffer(type: "image/png"): Buffer };
    };
    await page.render({ canvas: canvas as never, viewport }).promise;
    pages.push(canvas.toBuffer("image/png"));
  }
  await doc.loadingTask.destroy();
  return pages;
}

/** The service fits an image inside this square before anything else, so wider is wasted. */
const MAX_BAND_WIDTH = 2048;

/**
 * One page as horizontal bands, each twice as wide as tall and overlapping its neighbour by a
 * tenth, top to bottom. A band keeps every table row whole from edge to edge, and the service
 * then sees it about twice as large as it sees the whole page.
 */
export async function pageBands(page: Buffer): Promise<Buffer[]> {
  const image = await loadImage(page);
  const bandHeight = Math.round(image.width / 2);
  if (image.height <= bandHeight * 1.25) return [page];
  const count = Math.ceil((image.height - bandHeight) / (bandHeight * 0.9)) + 1;
  const scale = Math.min(1, MAX_BAND_WIDTH / image.width);
  const bands: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.round((i * (image.height - bandHeight)) / (count - 1));
    const canvas = createCanvas(Math.round(image.width * scale), Math.round(bandHeight * scale));
    canvas
      .getContext("2d")
      .drawImage(image, 0, top, image.width, bandHeight, 0, 0, canvas.width, canvas.height);
    bands.push(canvas.toBuffer("image/png"));
  }
  return bands;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

/** One strict-JSON completion. The request is run-llm.ts's, with the system prompt a parameter. */
export async function complete(
  system: string,
  content: string | Part[],
  schema: Record<string, unknown>,
): Promise<{ json: Record<string, unknown>; usage: Usage; latencyMs: number }> {
  const endpoint = requireEnv("AZURE_OPENAI_ENDPOINT").replace(/\/$/, "");
  const deployment = requireEnv("AZURE_OPENAI_DEPLOYMENT");
  const apiVersion = requireEnv("AZURE_OPENAI_API_VERSION");
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "api-key": requireEnv("AZURE_OPENAI_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        temperature: 0,
        max_tokens: 8000,
        response_format: {
          type: "json_schema",
          json_schema: { name: "HrPayslip", schema, strict: true },
        },
      }),
    });
    // A throttled request is not a result: wait as told and ask again, outside the timing.
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("retry-after") ?? 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: Usage;
    };
    return {
      json: JSON.parse(body.choices[0]!.message.content) as Record<string, unknown>,
      usage: body.usage,
      latencyMs: Date.now() - started,
    };
  }
}
