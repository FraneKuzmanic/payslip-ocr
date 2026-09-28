import { describe, expect, it } from "vitest";
import { downscaleTarget } from "./downscale";

const KB = 1024;
const MB = 1024 * KB;

describe("downscaleTarget", () => {
  it("keeps a photo within the long edge and the byte cap (A02.jpg)", () => {
    expect(downscaleTarget(1220, 2712, 531 * KB)).toBeNull();
  });

  it("scales a long edge over 3,000 px down to 3,000 px (B02.jpg)", () => {
    expect(downscaleTarget(3024, 4032, 3.5 * MB)).toEqual({ width: 2250, height: 3000 });
  });

  it("keeps a photo whose long edge is exactly 3,000 px", () => {
    expect(downscaleTarget(3000, 2000, 1 * MB)).toBeNull();
  });

  it("re-encodes an over-size file at its own dimensions", () => {
    expect(downscaleTarget(2000, 1500, 5 * MB)).toEqual({ width: 2000, height: 1500 });
  });

  it("rounds the short edge and never lets it reach zero", () => {
    expect(downscaleTarget(4000, 100, 1 * MB)).toEqual({ width: 3000, height: 75 });
    expect(downscaleTarget(9000, 1, 1 * MB)).toEqual({ width: 3000, height: 1 });
  });
});
