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
