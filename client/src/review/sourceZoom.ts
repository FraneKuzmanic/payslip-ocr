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
 * That composition renders a content point `p` (in unzoomed content-pixel coordinates) at
 * `x + zoom * p`, which is what every formula below inverts. Percentage translations cannot express
 * this: their percentages resolve against the transformed element's own box, not the clipping
 * viewport, which is the exact bug the mobile crop strip shipped with in iteration 15.
 *
 * The **viewport** is the clipping frame; the **content** is the page's size at zoom 1. They are
 * equal when the whole page fits its frame (the phone). At fit width (Task 14 D17) the content is
 * the frame's width by `width / ratio`, usually taller than the frame. Every function takes the
 * content last and defaults it to the viewport, so a caller that fits the page is unchanged.
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
 * The zoom that shows the whole page: 1 when the page already fits, less when the content is larger
 * than its frame. An unmeasured (zero) size counts as fitting.
 */
export function minZoomFor(viewport: Viewport, content: Viewport = viewport): number {
  if (content.width <= 0 || content.height <= 0) return MIN_ZOOM;
  return Math.min(MIN_ZOOM, viewport.width / content.width, viewport.height / content.height);
}

/** Per axis: a smaller page is centred, a larger one must cover the frame. */
function clampAxis(offset: number, frame: number, scaled: number) {
  if (scaled <= frame) return (frame - scaled) / 2;
  return clamp(offset, frame - scaled, 0);
}

/**
 * Keeps the scaled content covering the viewport, so panning can never reveal empty space beside
 * the document; content smaller than the viewport is centred instead (Task 14 D17). When the page
 * fits, the only permitted offset at `zoom === 1` is `0`, which is what makes "reset" and "zoomed
 * all the way out" the same state.
 */
export function clampPan(
  state: ZoomState,
  viewport: Viewport,
  content: Viewport = viewport,
): ZoomState {
  const zoom = clamp(state.zoom, minZoomFor(viewport, content), MAX_ZOOM);
  return {
    zoom,
    x: clampAxis(state.x, viewport.width, content.width * zoom),
    y: clampAxis(state.y, viewport.height, content.height * zoom),
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
  content: Viewport = viewport,
): ZoomState {
  const zoom = clamp(nextZoom, minZoomFor(viewport, content), MAX_ZOOM);
  const contentX = (anchor.x - state.x) / state.zoom;
  const contentY = (anchor.y - state.y) / state.zoom;
  return clampPan(
    { zoom, x: anchor.x - zoom * contentX, y: anchor.y - zoom * contentY },
    viewport,
    content,
  );
}

/** Pans (without changing zoom) so the page-relative point `(fx, fy)` sits at the viewport centre. */
export function centreOn(
  state: ZoomState,
  viewport: Viewport,
  fx: number,
  fy: number,
  content: Viewport = viewport,
): ZoomState {
  return clampPan(
    {
      zoom: state.zoom,
      x: viewport.width / 2 - state.zoom * fx * content.width,
      y: viewport.height / 2 - state.zoom * fy * content.height,
    },
    viewport,
    content,
  );
}

/**
 * Pans by a wheel delta (Task 14 D17). At an edge the state comes back equal, which the caller reads
 * as "let the page scroll on", as nested scrolling does.
 */
export function panBy(
  state: ZoomState,
  viewport: Viewport,
  content: Viewport,
  dx: number,
  dy: number,
): ZoomState {
  return clampPan({ ...state, x: state.x + dx, y: state.y + dy }, viewport, content);
}

export interface PinchPoint {
  /** Distance between the two fingers, in viewport pixels. */
  distance: number;
  /** Their midpoint, in viewport pixels. */
  midpoint: { x: number; y: number };
}

/**
 * Two-finger zoom (Task 14 D19), always relative to the state when the second finger landed: the
 * zoom scales with the finger distance, and the content point that was under the starting midpoint
 * stays under the current one, so moving both fingers pans as well.
 */
export function pinchZoom(
  start: ZoomState,
  viewport: Viewport,
  content: Viewport,
  from: PinchPoint,
  to: PinchPoint,
): ZoomState {
  const zoom = clamp(
    (start.zoom * to.distance) / from.distance,
    minZoomFor(viewport, content),
    MAX_ZOOM,
  );
  const contentX = (from.midpoint.x - start.x) / start.zoom;
  const contentY = (from.midpoint.y - start.y) / start.zoom;
  return clampPan(
    { zoom, x: to.midpoint.x - zoom * contentX, y: to.midpoint.y - zoom * contentY },
    viewport,
    content,
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
  content: Viewport = viewport,
  margin = VISIBILITY_MARGIN,
) {
  const left = state.x + state.zoom * bounds.minX * content.width;
  const right = state.x + state.zoom * bounds.maxX * content.width;
  const top = state.y + state.zoom * bounds.minY * content.height;
  const bottom = state.y + state.zoom * bounds.maxY * content.height;
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
