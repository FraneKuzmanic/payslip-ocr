import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceRegion } from "@payslip/shared";
import { RegionPopover } from "./RegionPopover";
import { SourceOverlay } from "./SourceOverlay";
import {
  FIT,
  MAX_ZOOM,
  ZOOM_STEP,
  boundsOf,
  centreOn,
  centroidOf,
  clampPan,
  isRegionVisible,
  minZoomFor,
  panBy,
  pinchZoom,
  zoomAbout,
  type PinchPoint,
  type Viewport,
  type ZoomState,
} from "./sourceZoom";

/**
 * `focus` — clicking an outline focuses the matching input directly. Correct on desktop, where the
 * form sits beside the source and nothing is obscured.
 *
 * `popover` — clicking an outline opens a read-only card instead, and only its Edit action moves
 * focus. Correct on a phone, where focusing an input raises the keyboard over the source.
 */
export type RegionInteraction = "focus" | "popover";

/**
 * `page` — the frame has the page's ratio and the whole page fits it at zoom 1 (the phone).
 *
 * `width` — the frame is the column's width by a screen-height budget, and zoom 1 is the page at
 * the column's width, scrolled by the wheel (desktop, Task 14 D17).
 */
export type SourceFit = "page" | "width";

/** How long the zoom must hold still before a PDF is redrawn at it (Task 14 D18). */
export const SETTLE_MS = 200;

interface ZoomableSourceViewportProps {
  /** Width ÷ height of the painted surface. Drives the container box, so it must describe what is
   *  actually painted — not what the API believes the page measures. */
  ratio: number;
  fit?: SourceFit;
  /** Whether outlines may be drawn. False suppresses them without disturbing the surface. */
  overlaySafe: boolean;
  regions: readonly SourceRegion[];
  page: number;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  ungroundableFields: readonly string[];
  unreadableFields: readonly string[];
  editedFields: readonly string[];
  /** Absent while there is no form to focus (Task 08 D2): regions still open the popover. */
  onSelect?: (field: string) => void;
  /**
   * The page has outlines but its rendered ratio disagrees with the declared one, so they are
   * withheld; a note says why (Task 08 D10).
   */
  outlinesWithheld?: boolean;
  /** Drawn over the frame, e.g. while the next PDF page is measured (Task 14 D20). */
  overlay?: React.ReactNode;
  /**
   * The painted surface — an `<img>` or a `<canvas>` — given the page's size at zoom 1 in CSS pixels,
   * and the zoom once it has held still for `SETTLE_MS`.
   */
  children: (content: Viewport, settledZoom: number) => React.ReactNode;
  /** Optional row beneath the viewport, used by the PDF pager. */
  footer?: React.ReactNode;
}

/**
 * The zoom, pan and region-interaction shell shared by the photo and PDF source viewers.
 *
 * This exists as one component rather than two because almost none of it is obvious: the pointer
 * capture is deferred, the wheel listener is non-passive, the click after a drag is suppressed, and
 * each of those is a real defect that was found in a browser and fixed once. A second copy would
 * drift away from those fixes silently — every one of them passes a jsdom test either way.
 */
export function ZoomableSourceViewport({
  ratio,
  fit = "page",
  overlaySafe,
  regions,
  page,
  activeField,
  interaction,
  fieldValues,
  lowConfidenceFields,
  ungroundableFields,
  unreadableFields,
  editedFields,
  onSelect,
  outlinesWithheld = false,
  overlay,
  children,
  footer,
}: ZoomableSourceViewportProps) {
  const { t } = useTranslation();
  const [inspected, setInspected] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [view, setView] = useState<ZoomState>(FIT);
  const [settledZoom, setSettledZoom] = useState(FIT.zoom);
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const surfaceNode = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  // Every pointer down on the frame, so a second finger can start a pinch (Task 14 D19).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ start: ZoomState; from: PinchPoint; moved: boolean } | null>(null);
  // A pan that ends over an outline still dispatches a click on it. Without this the document would
  // jump to a different field every time the user finished dragging.
  const suppressClick = useRef(false);

  // The page's size at zoom 1. Fitting the page, it is the frame itself; fitting the width, it is the
  // frame's width by the page's height at that width, usually taller than the frame (Task 14 D17).
  const content = useMemo<Viewport>(
    () =>
      fit === "width" && viewport.width > 0 && ratio > 0
        ? { width: viewport.width, height: viewport.width / ratio }
        : viewport,
    [fit, ratio, viewport],
  );

  // Read by the native wheel listener, which is attached once and must not restart per render.
  const latest = useRef({ view, viewport, content, fit });
  useLayoutEffect(() => {
    latest.current = { view, viewport, content, fit };
  }, [view, viewport, content, fit]);

  // The viewport's pixel size is load-bearing for pan clamping and for centring a field, and it
  // changes on rotate and on any container resize — a one-shot measurement would silently go stale.
  const measureRef = useCallback((element: HTMLDivElement | null) => {
    viewportNode.current = element;
    if (element === null) return;
    setViewport({ width: element.clientWidth, height: element.clientHeight });
  }, []);

  useEffect(() => {
    const element = viewportNode.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Re-clamp after the viewport changes size, so a rotation cannot leave the surface panned off-view.
  useEffect(() => {
    setView((current) => clampPan(current, viewport, content));
  }, [viewport, content]);

  // The PDF path redraws its bitmap at the zoom the user settles on, not on every gesture frame.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledZoom(view.zoom), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [view.zoom]);

  // A field on another page has no outline to raise here, so the popover must not survive the jump.
  // A new page opens at zoom 1, as it did when the viewer was remounted per page (Task 14 D20);
  // `latest` is current here, since layout effects run first.
  useEffect(() => {
    setInspected(null);
    setView(clampPan(FIT, latest.current.viewport, latest.current.content));
  }, [page]);

  // Escape closes the popover (Task 09 D9). It takes no focus when it opens, so focus is moved
  // only if the user had tabbed into it; then it goes to the viewport rather than the page body.
  useEffect(() => {
    if (inspected === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const popover = document.activeElement?.closest('[role="dialog"]');
      const focusWasInside = popover != null && surfaceNode.current?.contains(popover) === true;
      setInspected(null);
      if (focusWasInside) viewportNode.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inspected]);

  const region = findRegion(regions, page, activeField);

  // Zooming in largely breaks the form-to-source link on its own, because the focused field's
  // outline is usually outside the visible area. Pan to it, but only when it is not already shown.
  // At fit width that holds at any zoom, since the page is taller than its frame (Task 14 D17).
  useEffect(() => {
    if (region === null || viewport.width === 0) return;
    const centre = centroidOf(region.corners);
    const bounds = boundsOf(region.corners);
    setView((current) => {
      if (isRegionVisible(current, viewport, bounds, content)) return current;
      const next = centreOn(current, viewport, centre.x, centre.y, content);
      return sameView(next, current) ? current : next;
    });
  }, [region, viewport, content]);

  // React attaches its `wheel` listener passively at the root, so `preventDefault` inside an
  // `onWheel` prop is silently ignored and the page scrolls anyway. A native non-passive listener
  // is the only way to make the surface consume the gesture.
  useEffect(() => {
    const element = viewportNode.current;
    if (element === null) return;
    function onWheel(event: WheelEvent) {
      const rect = element!.getBoundingClientRect();
      const frame = { width: rect.width, height: rect.height };
      const current = latest.current;
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      if (current.fit === "page") {
        event.preventDefault();
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        setView((state) => zoomAbout(state, frame, state.zoom * factor, anchor));
        return;
      }

      // Fit width (Task 14 D17). Ctrl + wheel zooms, which is also what a trackpad pinch sends in
      // Chromium and Firefox: proportionally to the delta, so a pinch's many small events stay
      // smooth while a mouse notch still moves one step.
      if (event.ctrlKey) {
        event.preventDefault();
        const factor = Math.min(
          ZOOM_STEP,
          Math.max(1 / ZOOM_STEP, ZOOM_STEP ** (-event.deltaY / 100)),
        );
        setView((state) => zoomAbout(state, frame, state.zoom * factor, anchor, current.content));
        return;
      }

      // A plain wheel scrolls the document, and only consumes the event when the document moved, so
      // at its top or bottom edge the page scrolls on, as nested scrolling does.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.height : 1;
      const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
      const dy = (event.shiftKey ? 0 : event.deltaY) * unit;
      const next = panBy(current.view, frame, current.content, -dx, -dy);
      if (sameView(next, current.view)) return;
      event.preventDefault();
      latest.current = { ...current, view: next };
      setView(next);
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  function zoomByStep(factor: number) {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    setView((current) => zoomAbout(current, viewport, current.zoom * factor, centre, content));
  }

  function handleRegionClick(field: string) {
    if (suppressClick.current) return;
    if (interaction === "popover") setInspected(field);
    else onSelect?.(field);
  }

  /** The two fingers' distance and midpoint, relative to the frame. */
  function pinchPoint(element: HTMLElement): PinchPoint {
    const rect = element.getBoundingClientRect();
    const [a, b] = [...pointers.current.values()];
    return {
      distance: Math.max(1, Math.hypot(b!.x - a!.x, b!.y - a!.y)),
      midpoint: { x: (a!.x + b!.x) / 2 - rect.left, y: (a!.y + b!.y) / 2 - rect.top },
    };
  }

  function releasePointer(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pinch.current !== null && pointers.current.size < 2) {
      // Lifting the fingers after a pinch must not activate the outline beneath them.
      suppressClick.current = pinch.current.moved;
      pinch.current = null;
    }
  }

  const inspectedRegion = findRegion(regions, page, inspected);
  const minZoom = minZoomFor(viewport, content);
  const fitView = clampPan(FIT, viewport, content);
  // The page can be panned when, scaled, it is larger than the frame in either axis.
  const overflows =
    content.width * view.zoom > viewport.width + 0.5 ||
    content.height * view.zoom > viewport.height + 0.5;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <ZoomButton
          onClick={() => zoomByStep(1 / ZOOM_STEP)}
          disabled={view.zoom <= minZoom + 1e-9}
          label={t("review.zoomOut")}
        >
          <ZoomOut aria-hidden="true" className="size-5" />
        </ZoomButton>
        <ZoomButton
          onClick={() => zoomByStep(ZOOM_STEP)}
          disabled={view.zoom >= MAX_ZOOM}
          label={t("review.zoomIn")}
        >
          <ZoomIn aria-hidden="true" className="size-5" />
        </ZoomButton>
        {/* Reset is zoom 1: the whole page on a phone, the page's width from the top on desktop. */}
        <ZoomButton
          onClick={() => setView(fitView)}
          disabled={sameView(view, fitView)}
          label={t("review.zoomReset")}
        >
          <Maximize aria-hidden="true" className="size-5" />
        </ZoomButton>
        <span aria-live="polite" className="ml-1 text-sm tabular-nums text-slate-600">
          {t("review.zoomLevel", { percent: Math.round(view.zoom * 100) })}
        </span>
      </div>

      {/* Relative so the popover can be placed against the surface without being clipped by the
          viewport's own `overflow-hidden`. */}
      <div ref={surfaceNode} className="relative">
        <div
          ref={measureRef}
          // Focusable by script only, so focus has somewhere to land when the popover closes.
          tabIndex={-1}
          // Fitting the page, the width is computed from the height budget rather than left to
          // shrink-to-fit, so `height = width / ratio` lands exactly on that budget and a tall
          // document is never stretched. See iteration 15 — this was a real, visible distortion bug.
          // The budget is `--source-height`, in `svh` on the phone: `dvh` changed as the address bar
          // hid, resizing the frame and redrawing the canvas on every scroll (Task 14 D21). Fitting
          // the width, the frame is the column's width by that budget (Task 14 D17).
          // `select-none` stops the drag gesture from being read as a text/image selection —
          // without it, dragging while zoomed paints the browser's native blue selection highlight
          // over the document instead of panning it cleanly.
          // `touch-action` (Task 14 D19): `pan-y` lets one finger scroll the page past a document
          // that fits, and hands two fingers to the pinch below instead of the browser's page zoom;
          // `none` gives every touch to the pan once the document overflows its frame.
          className={`relative select-none overflow-hidden ${
            fit === "page" ? "mx-auto max-h-[var(--source-height,65svh)] max-w-full" : "w-full"
          } ${overflows ? "cursor-grab touch-none active:cursor-grabbing" : "touch-pan-y"}`}
          style={
            fit === "page"
              ? {
                  aspectRatio: String(ratio),
                  width: `min(100%, var(--source-height, 65svh) * ${ratio})`,
                }
              : { height: "var(--source-height, 65svh)" }
          }
          onPointerDown={(event) => {
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2) {
              // A second finger turns the gesture into a pinch. Neither finger is captured, or
              // the outline click logic below breaks; a drag that had captured lets go.
              const active = drag.current;
              if (active?.captured) event.currentTarget.releasePointerCapture(active.pointerId);
              drag.current = null;
              pinch.current = { start: view, from: pinchPoint(event.currentTarget), moved: false };
              return;
            }
            if (!overflows || pointers.current.size > 1) return;
            // Capture is deliberately deferred to the first real move, not taken here. Once a
            // pointer is captured, the browser retargets its eventual `click` to the capturing
            // element — so an outline nested inside this box could never be clicked while zoomed,
            // even for a plain tap that never dragged anywhere. Recording the gesture without
            // capturing yet lets a stationary click reach the polygon exactly as it does at fit.
            drag.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: view.x,
              originY: view.y,
              moved: false,
              captured: false,
            };
          }}
          onPointerMove={(event) => {
            if (pointers.current.has(event.pointerId)) {
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            }
            const pinching = pinch.current;
            if (pinching !== null && pointers.current.size >= 2) {
              pinching.moved = true;
              setView(
                pinchZoom(
                  pinching.start,
                  viewport,
                  content,
                  pinching.from,
                  pinchPoint(event.currentTarget),
                ),
              );
              return;
            }
            const active = drag.current;
            if (active === null || active.pointerId !== event.pointerId) return;
            const dx = event.clientX - active.startX;
            const dy = event.clientY - active.startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
              active.moved = true;
              if (!active.captured) {
                active.captured = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            }
            setView((current) =>
              clampPan(
                { ...current, x: active.originX + dx, y: active.originY + dy },
                viewport,
                content,
              ),
            );
          }}
          onPointerUp={(event) => {
            releasePointer(event);
            const active = drag.current;
            if (active === null || active.pointerId !== event.pointerId) return;
            suppressClick.current = active.moved;
            drag.current = null;
            if (active.captured) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            releasePointer(event);
            const active = drag.current;
            drag.current = null;
            if (active?.captured) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          // A finger that leaves the frame uncaptured would otherwise stay in the pinch forever.
          onPointerLeave={(event) => {
            if (drag.current?.captured !== true) releasePointer(event);
          }}
          onClickCapture={() => {
            // Cleared one tick after the click the drag produced, so the next real tap works.
            if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
          }}
        >
          <div
            className="absolute top-0 left-0"
            style={{
              // Sized to the page, not the frame: at fit width it is taller than the frame (D17).
              width: content.width,
              height: content.height,
              transformOrigin: "0 0",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          >
            {children(content, settledZoom)}
            {overlaySafe ? (
              <SourceOverlay
                regions={regions}
                page={page}
                activeField={inspected ?? activeField}
                editedFields={editedFields}
                onSelect={handleRegionClick}
              />
            ) : null}
          </div>
          {overlay}
        </div>

        {inspected !== null && inspectedRegion !== null ? (
          <RegionPopover
            field={inspected}
            value={fieldValues[inspected] ?? null}
            lowConfidence={lowConfidenceFields.includes(inspected)}
            ungroundable={ungroundableFields.includes(inspected)}
            unreadable={unreadableFields.includes(inspected)}
            edited={editedFields.includes(inspected)}
            top={popoverTop(inspectedRegion, view, viewport, content)}
            onEdit={
              onSelect === undefined
                ? undefined
                : () => {
                    setInspected(null);
                    onSelect(inspected);
                  }
            }
            onClose={() => setInspected(null)}
          />
        ) : null}
      </div>

      {footer}

      {outlinesWithheld ? (
        <p className="text-sm text-slate-600">{t("review.highlightsWithheld")}</p>
      ) : null}
    </div>
  );
}

function sameView(a: ZoomState, b: ZoomState) {
  return (
    Math.abs(a.zoom - b.zoom) < 1e-9 && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
  );
}

function findRegion(regions: readonly SourceRegion[], page: number, field: string | null) {
  if (field === null) return null;
  return regions.find((region) => region.page === page && region.fields.includes(field)) ?? null;
}

/**
 * Places the card just under its outline, then clamps it inside the surface so a region near the
 * bottom edge cannot push it out of the panel. The outline is measured on the page (`content`), the
 * clamp against the frame (`viewport`).
 */
export function popoverTop(
  region: SourceRegion,
  view: ZoomState,
  viewport: Viewport,
  content: Viewport = viewport,
) {
  const bottom = Math.max(...region.corners.map((corner) => corner.y));
  const rendered = view.y + view.zoom * bottom * content.height;
  return Math.round(Math.min(Math.max(rendered + 8, 8), Math.max(8, viewport.height - 150)));
}

function ZoomButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}
