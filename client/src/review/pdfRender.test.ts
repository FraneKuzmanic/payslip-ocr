import { describe, expect, it } from "vitest";
import type { SourceRegion } from "@payslip/shared";
import { MAX_CANVAS_WIDTH, RENDER_QUALITY, pageForField, renderScale } from "./pdfRender";

/** A4 portrait at 72 dpi, which is what the sibling prototype's two sample PDFs measure. */
const A4_WIDTH = 595;

describe("renderScale", () => {
  it("rasterises above the displayed size so zooming stays legible", () => {
    // A phone-width column on a 1x display.
    expect(renderScale(A4_WIDTH, 340, 1)).toBeCloseTo((340 * RENDER_QUALITY) / A4_WIDTH, 10);
  });

  it("multiplies by the device pixel ratio", () => {
    const oneX = renderScale(A4_WIDTH, 340, 1);
    expect(renderScale(A4_WIDTH, 340, 2)).toBeCloseTo(oneX * 2, 10);
    expect(renderScale(A4_WIDTH, 340, 3)).toBeCloseTo(oneX * 3, 10);
  });

  it("caps the bitmap so a high-DPR phone cannot exhaust canvas memory", () => {
    // 3x DPR on a desktop-width column would ask for 640 * 3 * 2.5 = 4800px without the cap.
    const scale = renderScale(A4_WIDTH, 640, 3);
    expect(A4_WIDTH * scale).toBeCloseTo(MAX_CANVAS_WIDTH, 6);
  });

  it("treats an unmeasured viewport as 'do not render'", () => {
    expect(renderScale(A4_WIDTH, 0, 2)).toBe(0);
    expect(renderScale(0, 340, 2)).toBe(0);
  });

  it("falls back to 1x when the browser reports no device pixel ratio", () => {
    expect(renderScale(A4_WIDTH, 340, 0)).toBeCloseTo(renderScale(A4_WIDTH, 340, 1), 10);
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
