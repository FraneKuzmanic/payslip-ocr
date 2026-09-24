import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceRegion } from "@payslip/shared";
import { RegionPopover } from "./RegionPopover";
import { SourceOverlay } from "./SourceOverlay";
import {
  FIT,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  boundsOf,
  centreOn,
  centroidOf,
  clampPan,
  isRegionVisible,
  zoomAbout,
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

interface ZoomableSourceViewportProps {
  /** Width ÷ height of the painted surface. Drives the container box, so it must describe what is
   *  actually painted — not what the API believes the page measures. */
  ratio: number;
  /** Whether outlines may be drawn. False suppresses them without disturbing the surface. */
  overlaySafe: boolean;
  regions: readonly SourceRegion[];
  page: number;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  editedFields: readonly string[];
  onSelect: (field: string) => void;
  /** The painted surface — an `<img>` or a `<canvas>` — given the measured viewport in CSS pixels. */
  children: (viewport: Viewport) => React.ReactNode;
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
  overlaySafe,
  regions,
  page,
  activeField,
  interaction,
  fieldValues,
  lowConfidenceFields,
  editedFields,
  onSelect,
  children,
  footer,
}: ZoomableSourceViewportProps) {
  const { t } = useTranslation();
  const [inspected, setInspected] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [view, setView] = useState<ZoomState>(FIT);
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  // A pan that ends over an outline still dispatches a click on it. Without this the document would
  // jump to a different field every time the user finished dragging.
  const suppressClick = useRef(false);

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
    setView((current) => clampPan(current, viewport));
  }, [viewport]);

  // A field on another page has no outline to raise here, so the popover must not survive the jump.
  useEffect(() => {
    setInspected(null);
  }, [page]);

  const region = findRegion(regions, page, activeField);

  // Zooming in largely breaks the form-to-source link on its own, because the focused field's
  // outline is usually outside the visible area. Pan to it, but only when it is not already shown.
  useEffect(() => {
    if (region === null || viewport.width === 0) return;
    const centre = centroidOf(region.corners);
    const bounds = boundsOf(region.corners);
    setView((current) => {
      if (current.zoom <= MIN_ZOOM || isRegionVisible(current, viewport, bounds)) return current;
      return centreOn(current, viewport, centre.x, centre.y);
    });
  }, [region, viewport]);

  // React attaches its `wheel` listener passively at the root, so `preventDefault` inside an
  // `onWheel` prop is silently ignored and the page scrolls anyway. A native non-passive listener
  // is the only way to make the surface consume the gesture.
  useEffect(() => {
    const element = viewportNode.current;
    if (element === null) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((current) =>
        zoomAbout(
          current,
          { width: rect.width, height: rect.height },
          current.zoom * factor,
          anchor,
        ),
      );
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  function zoomByStep(factor: number) {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    setView((current) => zoomAbout(current, viewport, current.zoom * factor, centre));
  }

  function handleRegionClick(field: string) {
    if (suppressClick.current) return;
    if (interaction === "popover") setInspected(field);
    else onSelect(field);
  }

  const inspectedRegion = findRegion(regions, page, inspected);
  const zoomed = view.zoom > MIN_ZOOM;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <ZoomButton
          onClick={() => zoomByStep(1 / ZOOM_STEP)}
          disabled={view.zoom <= MIN_ZOOM}
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
        <ZoomButton onClick={() => setView(FIT)} disabled={!zoomed} label={t("review.zoomReset")}>
          <Maximize aria-hidden="true" className="size-5" />
        </ZoomButton>
        <span aria-live="polite" className="ml-1 text-sm tabular-nums text-slate-600">
          {t("review.zoomLevel", { percent: Math.round(view.zoom * 100) })}
        </span>
      </div>

      {/* Relative so the popover can be placed against the surface without being clipped by the
          viewport's own `overflow-hidden`. */}
      <div className="relative">
        <div
          ref={measureRef}
          // The width is computed from the height budget rather than left to shrink-to-fit, so
          // `height = width / ratio` lands exactly on that budget and a tall document is never
          // stretched. See iteration 15 — this was a real, visible distortion bug.
          // `select-none` stops the drag gesture from being read as a text/image selection —
          // without it, dragging while zoomed paints the browser's native blue selection highlight
          // over the document instead of panning it cleanly.
          className={`relative mx-auto max-h-[65dvh] max-w-full select-none overflow-hidden ${
            zoomed ? "cursor-grab touch-none active:cursor-grabbing" : ""
          }`}
          style={{ aspectRatio: String(ratio), width: `min(100%, 65dvh * ${ratio})` }}
          onPointerDown={(event) => {
            if (!zoomed) return;
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
              clampPan({ ...current, x: active.originX + dx, y: active.originY + dy }, viewport),
            );
          }}
          onPointerUp={(event) => {
            const active = drag.current;
            if (active === null || active.pointerId !== event.pointerId) return;
            suppressClick.current = active.moved;
            drag.current = null;
            if (active.captured) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            const active = drag.current;
            drag.current = null;
            if (active?.captured) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onClickCapture={() => {
            // Cleared one tick after the click the drag produced, so the next real tap works.
            if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              transformOrigin: "0 0",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          >
            {children(viewport)}
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
        </div>

        {inspected !== null && inspectedRegion !== null ? (
          <RegionPopover
            field={inspected}
            value={fieldValues[inspected] ?? null}
            lowConfidence={lowConfidenceFields.includes(inspected)}
            edited={editedFields.includes(inspected)}
            top={popoverTop(inspectedRegion, view, viewport)}
            onEdit={() => {
              setInspected(null);
              onSelect(inspected);
            }}
            onClose={() => setInspected(null)}
          />
        ) : null}
      </div>

      {footer}

      {interaction === "popover" && overlaySafe ? (
        <p className="text-sm text-slate-600">{t("review.inspectPrompt")}</p>
      ) : null}
    </div>
  );
}

function findRegion(regions: readonly SourceRegion[], page: number, field: string | null) {
  if (field === null) return null;
  return regions.find((region) => region.page === page && region.fields.includes(field)) ?? null;
}

/**
 * Places the card just under its outline, then clamps it inside the surface so a region near the
 * bottom edge cannot push it out of the panel.
 */
export function popoverTop(region: SourceRegion, view: ZoomState, viewport: Viewport) {
  const bottom = Math.max(...region.corners.map((corner) => corner.y));
  const rendered = view.y + view.zoom * bottom * viewport.height;
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
      className="inline-flex size-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}
