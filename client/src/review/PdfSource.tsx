import { useEffect, useRef, useState } from "react";
import type { SourceRegionsResponse } from "@payslip/shared";
import { Spinner } from "../components/Spinner";
import { useWideLayout } from "../history/useWideLayout";
import { PageNavigator } from "./PageNavigator";
import { SourceStrip } from "./SourceStrip";
import {
  isRenderCancellation,
  loadPdfDocument,
  type LoadedPdf,
  type PdfPageViewport,
} from "./pdfDocument";
import { pageForField, renderScale } from "./pdfRender";
import type { Viewport } from "./sourceZoom";
import { ZoomableSourceViewport, type RegionInteraction } from "./ZoomableSourceViewport";

/**
 * The API's page ratio and the rendered page's own ratio must agree before any outline is drawn.
 * They are computed from independent sources — Azure's reported page size in inches, and pdf.js's
 * media box in points after `/Rotate` — so agreement is real evidence that a box will land on its
 * text. Measured against the sibling prototype's two sample PDFs, the two differ by about 4e-4,
 * which is Azure rounding its dimensions; a rotated page would differ by far more than this bound.
 */
const RATIO_TOLERANCE = 0.01;

interface PdfSourceProps {
  strip?: boolean;
  url: string;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  ungroundableFields: readonly string[];
  unreadableFields: readonly string[];
  editedFields: readonly string[];
  onSelect?: (field: string) => void;
  /** Called when the document cannot be rendered, so the panel can fall back to the native viewer. */
  onUnavailable: () => void;
}

export function PdfSource({
  url,
  regions,
  activeField,
  interaction,
  fieldValues,
  lowConfidenceFields,
  ungroundableFields,
  unreadableFields,
  editedFields,
  onSelect,
  onUnavailable,
  strip = false,
}: PdfSourceProps) {
  const wide = useWideLayout();
  const [document, setDocument] = useState<LoadedPdf | null>(null);
  const [page, setPage] = useState(1);
  const [pageViewport, setPageViewport] = useState<(PdfPageViewport & { page: number }) | null>(
    null,
  );
  const host = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  // The review page mounts this panel twice — once inside the phone's "Show source" disclosure and
  // once in the desktop sidebar — and hides the wrong one with CSS. That costs an `<img>` nothing,
  // because the browser serves the second one from cache. A PDF is different: each mount would
  // fetch, spawn a worker and parse the document again. Waiting for the panel to actually have a
  // box on screen loads exactly one of them, and defers the phone's copy until the user opens it.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let loaded: LoadedPdf | null = null;
    setDocument(null);
    setPageViewport(null);
    setPage(1);
    loadPdfDocument(url, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) {
          next.destroy();
          return;
        }
        loaded = next;
        setDocument(next);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[review] could not render the PDF source document", error);
        onUnavailable();
      });
    return () => {
      controller.abort();
      loaded?.destroy();
    };
  }, [url, visible]);

  useEffect(() => {
    if (document === null) return;
    let current = true;
    document
      .viewportOf(page)
      .then((next) => {
        if (current) setPageViewport({ ...next, page });
      })
      .catch((error: unknown) => {
        console.error("[review] could not measure a PDF page", error);
        if (current) onUnavailable();
      });
    return () => {
      current = false;
    };
  }, [document, page]);

  // A field's outline can sit on a page the user is not looking at, which reads as the highlight
  // being missing rather than as the value being on page two. Follow the focus to its page.
  useEffect(() => {
    setPage((current) => pageForField(regions?.regions, activeField, current));
  }, [activeField, regions]);

  // The host box is always rendered, even while loading — it is what the observer above watches,
  // so it has to exist before there is anything to show inside it.
  if (document === null)
    return (
      <div ref={host}>
        <Spinner />
      </div>
    );

  if (pageViewport === null || pageViewport.page !== page)
    return strip ? (
      <div ref={host}>
        <Spinner />
      </div>
    ) : (
      <div ref={host} className={wide ? "flex min-w-0 gap-2" : ""}>
        {wide ? <PageNavigator document={document} page={page} onChange={setPage} wide /> : null}
        <div className="min-w-0 flex-1">
          <Spinner />
          {wide ? null : (
            <PageNavigator document={document} page={page} onChange={setPage} wide={false} />
          )}
        </div>
      </div>
    );

  const rendered = pageViewport.width / pageViewport.height;
  const declared = regions?.pages.find((entry) => entry.page === page)?.aspectRatio;
  const overlaySafe = declared !== undefined && Math.abs(rendered - declared) < RATIO_TOLERANCE;

  if (strip)
    return (
      <div ref={host}>
        <SourceStrip
          ratio={rendered}
          overlaySafe={overlaySafe}
          regions={regions?.regions ?? []}
          page={page}
          activeField={activeField}
          editedFields={editedFields}
        >
          {(width) => (
            <PdfCanvas
              document={document}
              page={page}
              pageWidth={pageViewport.width}
              viewport={{ width, height: width / rendered }}
              onFailed={onUnavailable}
            />
          )}
        </SourceStrip>
      </div>
    );

  return (
    <div ref={host} className={wide ? "flex min-w-0 gap-2" : ""}>
      {wide ? <PageNavigator document={document} page={page} onChange={setPage} wide /> : null}
      <div className="min-w-0 flex-1">
        <ZoomableSourceViewport
          // The painted page's own ratio, never the API's: the box must fit what is actually drawn, so
          // a disagreement costs the outlines rather than distorting the document.
          ratio={rendered}
          overlaySafe={overlaySafe}
          regions={regions?.regions ?? []}
          page={page}
          activeField={activeField}
          interaction={interaction}
          fieldValues={fieldValues}
          lowConfidenceFields={lowConfidenceFields}
          ungroundableFields={ungroundableFields}
          unreadableFields={unreadableFields}
          editedFields={editedFields}
          onSelect={onSelect}
          // Only reachable once the page is measured, so the note never shows while loading (D10).
          outlinesWithheld={
            !overlaySafe && (regions?.regions.some((region) => region.page === page) ?? false)
          }
        >
          {(viewport) => (
            <PdfCanvas
              document={document}
              page={page}
              pageWidth={pageViewport.width}
              viewport={viewport}
              onFailed={onUnavailable}
            />
          )}
        </ZoomableSourceViewport>
        {wide ? null : (
          <PageNavigator document={document} page={page} onChange={setPage} wide={false} />
        )}
      </div>
    </div>
  );
}

interface PdfCanvasProps {
  document: LoadedPdf;
  page: number;
  pageWidth: number;
  viewport: Viewport;
  onFailed: () => void;
}

export function PdfCanvas({ document, page, pageWidth, viewport, onFailed }: PdfCanvasProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    const scale = renderScale(pageWidth, viewport.width, window.devicePixelRatio);
    // Scale 0 means the viewport has not been measured yet. Painting at a guessed size would leave
    // a blurry page that never refreshes, because the real measurement reports no further change.
    if (element === null || scale === 0) return;
    const task = document.render(page, scale, element);
    task.completed.catch((error: unknown) => {
      // Cancellation is the normal result of changing page or leaving the route, not a failure.
      if (isRenderCancellation(error)) return;
      console.error("[review] could not paint a PDF page", error);
      onFailed();
    });
    return () => task.cancel();
  }, [document, page, pageWidth, viewport.width]);

  // CSS sizes the element while `pdfDocument` sizes the bitmap, exactly as the image path lets the
  // box size an `<img>` whose intrinsic pixels are larger.
  return <canvas ref={canvas} className="block size-full" />;
}
