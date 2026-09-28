import { describe, expect, it } from "vitest";
import type { SourceRegion } from "@payslip/shared";
import {
  DESKTOP_PIXEL_BUDGET,
  PHONE_PIXEL_BUDGET,
  RENDER_QUALITY,
  needsRedraw,
  pageForField,
  renderScale,
} from "./pdfRender";

/** A4 portrait at 72 dpi, which is what the sibling prototype's two sample PDFs measure. */
const A4_WIDTH = 595;
const A4_HEIGHT = 842;

describe("renderScale", () => {
  it("rasterises above the displayed size so zooming stays legible", () => {
    // A phone-width column on a 1x display.
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 340, 1)).toBeCloseTo(
      (340 * RENDER_QUALITY) / A4_WIDTH,
      10,
    );
  });

  it("multiplies by the device pixel ratio", () => {
    const oneX = renderScale(A4_WIDTH, A4_HEIGHT, 340, 1);
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 340, 2)).toBeCloseTo(oneX * 2, 10);
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 340, 3)).toBeCloseTo(oneX * 3, 10);
  });

  it("renders at the fitted quality until the zoom passes it", () => {
    const fit = renderScale(A4_WIDTH, A4_HEIGHT, 800, 1);
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 800, 1, 1)).toBe(fit);
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 800, 1, RENDER_QUALITY)).toBe(fit);
  });

  it("follows the settled zoom past the fitted quality (Task 14 D18)", () => {
    // 800 px at 500% on a 1x display: 4,000 px wide, about 22.6 MP, under the desktop budget.
    const scale = renderScale(A4_WIDTH, A4_HEIGHT, 800, 1, 5);
    expect(A4_WIDTH * scale).toBeCloseTo(4000, 6);
    expect(4000 * 4000 * (A4_HEIGHT / A4_WIDTH)).toBeLessThan(DESKTOP_PIXEL_BUDGET);
  });

  it("caps the bitmap's area at the pixel budget", () => {
    const scale = renderScale(A4_WIDTH, A4_HEIGHT, 800, 2, 8);
    const area = A4_WIDTH * scale * A4_HEIGHT * scale;
    expect(area).toBeLessThanOrEqual(DESKTOP_PIXEL_BUDGET * (1 + 1e-9));
    expect(area).toBeCloseTo(DESKTOP_PIXEL_BUDGET, -2);
  });

  it("caps sooner on a phone, whose canvas limit is lower", () => {
    const desktop = renderScale(A4_WIDTH, A4_HEIGHT, 343, 3, 8);
    const phone = renderScale(A4_WIDTH, A4_HEIGHT, 343, 3, 8, PHONE_PIXEL_BUDGET);
    expect(phone).toBeLessThan(desktop);
    expect(A4_WIDTH * phone * A4_HEIGHT * phone).toBeLessThanOrEqual(
      PHONE_PIXEL_BUDGET * (1 + 1e-9),
    );
  });

  it("never draws a phone page larger than the pre-Task 14 cap, yet keeps its fit render", () => {
    // Before Task 14 no bitmap was wider than 2,600 px, which the product owner's Android phone drew.
    const zoomed = renderScale(A4_WIDTH, A4_HEIGHT, 343, 3, 8, PHONE_PIXEL_BUDGET);
    expect(A4_WIDTH * zoomed).toBeLessThanOrEqual(2600);
    expect(A4_WIDTH * zoomed).toBeGreaterThan(2590);
    // A 3x phone's fit render is 343 x 3 x 2.5 = 2,572 px wide, under the cap, so it is unchanged.
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 343, 3, 1, PHONE_PIXEL_BUDGET)).toBe(
      renderScale(A4_WIDTH, A4_HEIGHT, 343, 3, 1),
    );
  });

  it("treats an unmeasured viewport as 'do not render'", () => {
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 0, 2)).toBe(0);
    expect(renderScale(0, A4_HEIGHT, 340, 2)).toBe(0);
    expect(renderScale(A4_WIDTH, 0, 340, 2)).toBe(0);
  });

  it("falls back to 1x when the browser reports no device pixel ratio", () => {
    expect(renderScale(A4_WIDTH, A4_HEIGHT, 340, 0)).toBeCloseTo(
      renderScale(A4_WIDTH, A4_HEIGHT, 340, 1),
      10,
    );
  });
});

describe("needsRedraw", () => {
  it("skips a redraw within 1% of the current bitmap", () => {
    expect(needsRedraw(2000, 2000)).toBe(false);
    expect(needsRedraw(2000, 2019)).toBe(false);
    expect(needsRedraw(2000, 1981)).toBe(false);
  });

  it("redraws past 1%, in either direction, and when nothing is drawn yet", () => {
    expect(needsRedraw(2000, 2030)).toBe(true);
    expect(needsRedraw(2000, 1500)).toBe(true);
    expect(needsRedraw(0, 1200)).toBe(true);
  });
});

function region(page: number, fields: string[]): SourceRegion {
  return {
    fields,
    page,
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    origin: "model",
  };
}

describe("pageForField", () => {
  const regions = [region(1, ["sellerName"]), region(3, ["total", "currency"])];

  it("finds the page a field's outline is drawn on", () => {
    expect(pageForField(regions, "sellerName", 1)).toBe(1);
    expect(pageForField(regions, "total", 1)).toBe(3);
    expect(pageForField(regions, "currency", 1)).toBe(3);
  });

  it("stays on the current page for a field with no region", () => {
    expect(pageForField(regions, "jir", 2)).toBe(2);
  });

  it("stays put when nothing is focused or nothing has loaded", () => {
    expect(pageForField(regions, null, 2)).toBe(2);
    expect(pageForField(undefined, "total", 2)).toBe(2);
  });
});
