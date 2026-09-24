export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.5;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * `zoom` plus a pan offset in **viewport pixels**, applied as
 * `transform: translate(x, y) scale(zoom)` with `transform-origin: 0 0`.
 *
 * That composition renders a content point `p` (in unzoomed viewport-pixel coordinates) at
 * `x + zoom * p`, which is what every formula below inverts. Percentage translations cannot express
 * this: their percentages resolve against the transformed element's own box, not the clipping
 * viewport, which is the exact bug the mobile crop strip shipped with in iteration 15.
 */
export interface ZoomState {
  zoom: number;
  x: number;
  y: number;
}

export const FIT: ZoomState = { zoom: MIN_ZOOM, x: 0, y: 0 };

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Keeps the scaled content covering the viewport, so panning can never reveal empty space beside
 * the document. At `zoom === 1` the only permitted offset is `0`, which is what makes "reset" and
 * "zoomed all the way out" the same state.
 */
export function clampPan(state: ZoomState, viewport: Viewport): ZoomState {
  const zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom,
    x: clamp(state.x, Math.min(0, viewport.width - viewport.width * zoom), 0),
    y: clamp(state.y, Math.min(0, viewport.height - viewport.height * zoom), 0),
  };
}

/**
 * Changes zoom while holding `anchor` (a point in viewport pixels) still, so wheel zoom tracks the
 * cursor and button zoom holds the centre of the view.
 */
export function zoomAbout(
  state: ZoomState,
  viewport: Viewport,
  nextZoom: number,
  anchor: { x: number; y: number },
): ZoomState {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const contentX = (anchor.x - state.x) / state.zoom;
  const contentY = (anchor.y - state.y) / state.zoom;
  return clampPan({ zoom, x: anchor.x - zoom * contentX, y: anchor.y - zoom * contentY }, viewport);
}

/** Pans (without changing zoom) so the page-relative point `(fx, fy)` sits at the viewport centre. */
export function centreOn(state: ZoomState, viewport: Viewport, fx: number, fy: number): ZoomState {
  return clampPan(
    {
      zoom: state.zoom,
      x: viewport.width / 2 - state.zoom * fx * viewport.width,
      y: viewport.height / 2 - state.zoom * fy * viewport.height,
    },
    viewport,
  );
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(corners: readonly { x: number; y: number }[]): Bounds {
  if (corners.length === 0) return { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 };
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Whether an outline is comfortably on screen, used to auto-pan only when it actually helps.
 *
 * Tests the region's whole box against an inset viewport, not its centroid against the raw edges.
 * A centroid-only test called a field "visible" while its outline sat two pixels from the right
 * edge and was plainly clipped — measured in a real browser, and the reason the margin exists.
 */
export const VISIBILITY_MARGIN = 24;

export function isRegionVisible(
  state: ZoomState,
  viewport: Viewport,
  bounds: Bounds,
  margin = VISIBILITY_MARGIN,
) {
  const left = state.x + state.zoom * bounds.minX * viewport.width;
  const right = state.x + state.zoom * bounds.maxX * viewport.width;
  const top = state.y + state.zoom * bounds.minY * viewport.height;
  const bottom = state.y + state.zoom * bounds.maxY * viewport.height;
  return (
    left >= margin &&
    right <= viewport.width - margin &&
    top >= margin &&
    bottom <= viewport.height - margin
  );
}

export function centroidOf(corners: readonly { x: number; y: number }[]) {
  if (corners.length === 0) return { x: 0.5, y: 0.5 };
  return {
    x: corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length,
    y: corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length,
  };
}
