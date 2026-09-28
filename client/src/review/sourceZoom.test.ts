import { describe, expect, it } from "vitest";
import {
  FIT,
  MAX_ZOOM,
  MIN_ZOOM,
  centreOn,
  centroidOf,
  clampPan,
  boundsOf,
  isRegionVisible,
  minZoomFor,
  panBy,
  pinchZoom,
  zoomAbout,
} from "./sourceZoom";

const viewport = { width: 400, height: 600 };

/** What the browser actually paints for `translate(x, y) scale(zoom)` with origin `0 0`. */
function renderedPoint(state: { zoom: number; x: number; y: number }, fx: number, fy: number) {
  return {
    x: state.x + state.zoom * fx * viewport.width,
    y: state.y + state.zoom * fy * viewport.height,
  };
}

describe("clampPan", () => {
  it("forbids any offset at fit, so reset and fully-zoomed-out are one state", () => {
    expect(clampPan({ zoom: 1, x: -80, y: 42 }, viewport)).toEqual(FIT);
  });

  it("never lets the scaled image uncover the viewport", () => {
    const panned = clampPan({ zoom: 2, x: -5000, y: -5000 }, viewport);
    expect(panned.x).toBe(-viewport.width);
    expect(panned.y).toBe(-viewport.height);
    // A positive offset would slide the image away from the top-left corner, uncovering it.
    expect(clampPan({ zoom: 2, x: 5000, y: 5000 }, viewport)).toEqual({ zoom: 2, x: 0, y: 0 });
    // Bottom-right corner of the content still sits on or past the viewport's far edge.
    const corner = renderedPoint(panned, 1, 1);
    expect(corner.x).toBeGreaterThanOrEqual(viewport.width);
    expect(corner.y).toBeGreaterThanOrEqual(viewport.height);
  });

  it("holds zoom inside its bounds", () => {
    expect(clampPan({ zoom: 99, x: 0, y: 0 }, viewport).zoom).toBe(MAX_ZOOM);
    expect(clampPan({ zoom: 0.1, x: 0, y: 0 }, viewport).zoom).toBe(MIN_ZOOM);
  });
});

describe("zoomAbout", () => {
  it("holds the anchor point still, which is what makes wheel zoom track the cursor", () => {
    const anchor = { x: 120, y: 300 };
    const start = { zoom: 2, x: -100, y: -200 };
    // The content coordinate currently under the anchor.
    const fx = (anchor.x - start.x) / (start.zoom * viewport.width);
    const fy = (anchor.y - start.y) / (start.zoom * viewport.height);

    const next = zoomAbout(start, viewport, 4, anchor);

    expect(next.zoom).toBe(4);
    const after = renderedPoint(next, fx, fy);
    expect(after.x).toBeCloseTo(anchor.x, 5);
    expect(after.y).toBeCloseTo(anchor.y, 5);
  });

  it("returns to a zero offset when zoomed back out to fit", () => {
    const zoomedIn = zoomAbout(FIT, viewport, 4, { x: 10, y: 10 });
    expect(zoomedIn.x).not.toBe(0);
    expect(zoomAbout(zoomedIn, viewport, 1, { x: 10, y: 10 })).toEqual(FIT);
  });
});

describe("centreOn", () => {
  it("puts the requested point at the centre of the viewport", () => {
    const centred = centreOn({ zoom: 3, x: 0, y: 0 }, viewport, 0.5, 0.5);
    const rendered = renderedPoint(centred, 0.5, 0.5);
    expect(rendered.x).toBeCloseTo(viewport.width / 2, 5);
    expect(rendered.y).toBeCloseTo(viewport.height / 2, 5);
  });

  it("still clamps, so a field near an edge stays on screen rather than centred", () => {
    const centred = centreOn({ zoom: 2, x: 0, y: 0 }, viewport, 0.02, 0.02);
    expect(centred.x).toBe(0);
    expect(centred.y).toBe(0);
    expect(centred.zoom).toBe(2);
  });
});

describe("isRegionVisible", () => {
  const state = { zoom: 4, x: 0, y: 0 };

  it("distinguishes a region inside the view from one panned out of it", () => {
    expect(
      isRegionVisible(
        state,
        viewport,
        boundsOf([
          { x: 0.1, y: 0.1 },
          { x: 0.15, y: 0.12 },
        ]),
      ),
    ).toBe(true);
    expect(
      isRegionVisible(
        state,
        viewport,
        boundsOf([
          { x: 0.9, y: 0.9 },
          { x: 0.95, y: 0.92 },
        ]),
      ),
    ).toBe(false);
  });

  it("treats a region clipped by the viewport edge as not visible", () => {
    // The real defect this guards: a centroid two pixels inside the right edge counted as visible,
    // so auto-pan never fired and the outline stayed clipped. Measured in a browser, not theorised.
    const clipped = boundsOf([
      { x: 0.23, y: 0.1 },
      { x: 0.249, y: 0.12 },
    ]);
    const centroidX = state.x + state.zoom * 0.2395 * viewport.width;
    const rightEdgeX = state.x + state.zoom * clipped.maxX * viewport.width;
    expect(centroidX).toBeLessThan(viewport.width); // a centroid test would call this "visible"
    expect(rightEdgeX).toBeGreaterThan(viewport.width - 24); // but the box is against the edge
    expect(isRegionVisible(state, viewport, clipped)).toBe(false);
  });
});

describe("centroidOf", () => {
  it("averages the corners and falls back to the middle for an empty polygon", () => {
    const centre = centroidOf([
      { x: 0.2, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ]);
    expect(centre.x).toBeCloseTo(0.4, 10);
    expect(centre.y).toBeCloseTo(0.5, 10);
    expect(centroidOf([])).toEqual({ x: 0.5, y: 0.5 });
  });
});

/**
 * Fit width (Task 14 D17): the frame is the column's width by a screen-height budget, and the page
 * at zoom 1 is the column's width by `width / ratio`, taller than the frame.
 */
describe("fit width: content larger than its frame", () => {
  const frame = { width: 600, height: 500 };
  const content = { width: 600, height: 849 };

  it("lets the page scroll vertically at zoom 1, from the top to the bottom edge", () => {
    expect(clampPan({ zoom: 1, x: 0, y: 50 }, frame, content)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampPan({ zoom: 1, x: -40, y: -1000 }, frame, content)).toEqual({
      zoom: 1,
      x: 0,
      y: -349,
    });
  });

  it("zooms out no further than the whole page, centred horizontally", () => {
    const minimum = minZoomFor(frame, content);
    expect(minimum).toBeCloseTo(500 / 849, 10);
    const whole = clampPan({ zoom: 0.1, x: 0, y: 0 }, frame, content);
    expect(whole.zoom).toBeCloseTo(minimum, 10);
    expect(whole.x).toBeCloseTo((600 - 600 * minimum) / 2, 6);
    expect(whole.y).toBeCloseTo(0, 6);
  });

  it("never allows a minimum above 1, and survives an unmeasured size", () => {
    expect(minZoomFor({ width: 600, height: 900 }, { width: 600, height: 400 })).toBe(1);
    expect(minZoomFor(viewport, viewport)).toBe(MIN_ZOOM);
    expect(minZoomFor({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(1);
  });

  it("centres a page that is shorter than its frame instead of pinning it to the top", () => {
    const wide = { width: 600, height: 270 };
    expect(clampPan({ zoom: 1, x: 0, y: 0 }, frame, wide)).toEqual({ zoom: 1, x: 0, y: 115 });
  });

  it("scrolls down to a region near the bottom of the page at zoom 1", () => {
    const moved = centreOn(FIT, frame, 0.5, 0.9, content);
    expect(moved.zoom).toBe(1);
    expect(moved.y).toBe(-349);
  });

  it("measures region visibility against the page, not the frame", () => {
    const low = boundsOf([
      { x: 0.2, y: 0.8 },
      { x: 0.3, y: 0.82 },
    ]);
    expect(isRegionVisible(FIT, frame, low, content)).toBe(false);
    expect(isRegionVisible({ zoom: 1, x: 0, y: -349 }, frame, low, content)).toBe(true);
  });

  it("holds the cursor's point still while zooming", () => {
    const anchor = { x: 300, y: 250 };
    const start = { zoom: 1, x: 0, y: -100 };
    const contentY = (anchor.y - start.y) / start.zoom;
    const next = zoomAbout(start, frame, 2, anchor, content);
    expect(next.y + next.zoom * contentY).toBeCloseTo(anchor.y, 6);
  });
});

describe("panBy", () => {
  const frame = { width: 600, height: 500 };
  const content = { width: 600, height: 849 };

  it("moves the page and clamps it", () => {
    expect(panBy(FIT, frame, content, 0, -100)).toEqual({ zoom: 1, x: 0, y: -100 });
    expect(panBy(FIT, frame, content, 0, -1000)).toEqual({ zoom: 1, x: 0, y: -349 });
  });

  it("returns an equal state at the edge, so the caller lets the page scroll on", () => {
    const bottom = { zoom: 1, x: 0, y: -349 };
    expect(panBy(bottom, frame, content, 0, -60)).toEqual(bottom);
  });
});

describe("pinchZoom", () => {
  it("doubles the zoom when the fingers move twice as far apart, holding the midpoint still", () => {
    const start = { zoom: 1, x: 0, y: 0 };
    const midpoint = { x: 150, y: 200 };
    const next = pinchZoom(
      start,
      viewport,
      viewport,
      { distance: 100, midpoint },
      { distance: 200, midpoint },
    );
    expect(next.zoom).toBe(2);
    const under = renderedPoint(next, 150 / viewport.width, 200 / viewport.height);
    expect(under.x).toBeCloseTo(midpoint.x, 6);
    expect(under.y).toBeCloseTo(midpoint.y, 6);
  });

  it("carries the point under the fingers with the midpoint as it moves", () => {
    const start = { zoom: 2, x: -100, y: -100 };
    const from = { distance: 100, midpoint: { x: 200, y: 300 } };
    const to = { distance: 100, midpoint: { x: 180, y: 260 } };
    const fx = (from.midpoint.x - start.x) / (start.zoom * viewport.width);
    const fy = (from.midpoint.y - start.y) / (start.zoom * viewport.height);
    const next = pinchZoom(start, viewport, viewport, from, to);
    const under = renderedPoint(next, fx, fy);
    expect(under.x).toBeCloseTo(to.midpoint.x, 6);
    expect(under.y).toBeCloseTo(to.midpoint.y, 6);
  });
});
