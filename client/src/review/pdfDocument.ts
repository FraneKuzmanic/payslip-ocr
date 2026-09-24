import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/**
 * The only module in the client that knows pdf.js exists.
 *
 * Two things are deliberate here. **The legacy build**, because the modern one calls
 * `Uint8Array.prototype.toHex` — a very recent proposal absent from Node 24 and from the phones this
 * product targets (the last real-device check was a Huawei P20 Pro), and it throws on import rather
 * than degrading. **The dynamic import**, because pdf.js is roughly 150 KB plus a 390 KB worker
 * gzipped: a user who only ever photographs payslips must never download it.
 */
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjs: Promise<PdfJs> | null = null;

function library(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    // Set once per session, not per document — assigning it again mid-flight would strand a worker
    // that is already parsing a page.
    module.GlobalWorkerOptions.workerSrc = workerSrc;
    return module;
  });
  return pdfjs;
}

export interface PdfPageViewport {
  width: number;
  height: number;
}

export interface PdfRenderTask {
  completed: Promise<void>;
  cancel(): void;
}

export interface LoadedPdf {
  numPages: number;
  /** The page's intrinsic size in PDF points, with any `/Rotate` already applied. */
  viewportOf(page: number): Promise<PdfPageViewport>;
  /**
   * Paints `page` into `canvas`, sizing the bitmap itself.
   *
   * Returns a cancellable task rather than a bare promise, because switching page quickly must be
   * able to abandon the previous paint. Without that, page two finishes late and lands on a canvas
   * already showing page three.
   */
  render(page: number, scale: number, canvas: HTMLCanvasElement): PdfRenderTask;
  destroy(): void;
}

/**
 * The bytes are fetched here rather than handed to pdf.js as a URL. Given a URL, pdf.js issues
 * ranged, streamed requests, whose preflight and `Content-Range` handling are extra cross-origin
 * surface for no gain: `MAX_UPLOAD_BYTES` is 10 MB, so the whole document always fits in one buffer.
 */
export async function loadPdfDocument(url: string, signal?: AbortSignal): Promise<LoadedPdf> {
  const [module, response] = await Promise.all([library(), fetch(url, { signal })]);
  if (!response.ok) throw new Error(`Source document request failed with ${response.status}.`);
  const data = new Uint8Array(await response.arrayBuffer());

  // pdf.js 6 no longer evaluates font programs with `eval`, so there is no `isEvalSupported` to
  // switch off any more — a CSP added to the static site later cannot break rendering.
  const task = module.getDocument({ data, disableRange: true, disableStream: true });
  const document = await task.promise;

  return {
    numPages: document.numPages,
    async viewportOf(page) {
      const { width, height } = (await document.getPage(page)).getViewport({ scale: 1 });
      return { width, height };
    },
    render(page, scale, canvas) {
      let active: { cancel(): void } | null = null;
      let cancelled = false;
      const completed = (async () => {
        const rendered = await document.getPage(page);
        if (cancelled) return;
        const viewport = rendered.getViewport({ scale });
        // The bitmap is sized from the scaled viewport while CSS sizes the element itself. Setting
        // only one of the two is what silently stretches the page — and with it every outline drawn
        // on top, which is the defect shape iteration 15 shipped on the image path.
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const started = rendered.render({ canvas, viewport });
        active = started;
        await started.promise;
      })();
      return {
        completed,
        cancel() {
          cancelled = true;
          active?.cancel();
        },
      };
    },
    destroy() {
      // The loading task owns the worker, so tearing that down is what actually frees it.
      void task.destroy();
    },
  };
}

/**
 * pdf.js signals a cancelled render by throwing, which is routine here: changing page or leaving
 * the review route aborts whatever was painting. Only a genuine failure deserves the fallback
 * viewer.
 */
export function isRenderCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}
