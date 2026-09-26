import { describe, expect, it } from "vitest";
import { isObscured, overflowAfter, stripView } from "./stripGeometry";

const box = { width: 375, height: 64 };
describe("stripView", () => {
  it("magnifies a line to 45% of the strip height and centres it", () => {
    const view = stripView({ minX: 0.45, maxX: 0.55, minY: 0.49, maxY: 0.51 }, 0.7, box)!;
    expect((view.surfaceWidth / 0.7) * 0.02).toBeCloseTo(64 * 0.45);
    expect(view.x + 0.5 * view.surfaceWidth).toBeCloseTo(375 / 2);
    expect(view.y + (0.5 * view.surfaceWidth) / 0.7).toBeCloseTo(32);
  });
  it("fits a wide region inside 90% of the strip width", () => {
    const view = stripView({ minX: 0, maxX: 1, minY: 0.49, maxY: 0.5 }, 0.7, box)!;
    expect(view.surfaceWidth).toBeCloseTo(375 * 0.9);
  });
  it("clamps at the page margin without a blank edge", () => {
    const view = stripView({ minX: 0, maxX: 0.1, minY: 0.49, maxY: 0.51 }, 0.7, box)!;
    expect(view.x).toBe(0);
  });
  it("bounds magnification to eight strip widths", () => {
    expect(
      stripView({ minX: 0.5, maxX: 0.501, minY: 0.5, maxY: 0.501 }, 0.7, box)?.surfaceWidth,
    ).toBe(3000);
  });
  it("withholds a degenerate or unmeasured crop", () => {
    expect(stripView({ minX: 0, maxX: 1, minY: 0.5, maxY: 0.5 }, 0.7, box)).toBeNull();
    expect(
      stripView({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, 0.7, { width: 0, height: 64 }),
    ).toBeNull();
  });
});
it("detects inputs above and below the visible area", () => {
  expect(isObscured({ top: 50, bottom: 100 }, 64, 400)).toBe(true);
  expect(isObscured({ top: 380, bottom: 430 }, 64, 400)).toBe(true);
  expect(isObscured({ top: 64, bottom: 400 }, 64, 400)).toBe(false);
});
it("counts chips after the last fully visible chip", () => {
  expect(overflowAfter([true, true, false, false, false])).toEqual({ index: 1, count: 3 });
  expect(overflowAfter([true, false])).toEqual({ index: 0, count: 1 });
  expect(overflowAfter([false, true, true])).toBeNull();
  expect(overflowAfter([false])).toBeNull();
  expect(overflowAfter([true])).toBeNull();
});
