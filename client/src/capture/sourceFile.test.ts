import { describe, expect, it } from "vitest";
import {
  BLUR_VARIANCE_WARNING_THRESHOLD,
  MAX_CLIENT_UPLOAD_BYTES,
  MIN_RECOMMENDED_SHORT_EDGE,
  classifySourceFile,
  laplacianVariance,
  qualityWarnings,
} from "./sourceFile";

function file(name: string, type: string, size = 1): File {
  return new File([new Uint8Array(size)], name, { type });
}

function pixels(width: number, height: number, valueAt: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = valueAt(x, y);
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

describe("classifySourceFile", () => {
  it("accepts supported MIME types and empty-MIME extension fallbacks", () => {
    expect(classifySourceFile(file("payslip.jpg", "image/jpeg"))).toEqual({
      ok: true,
      kind: "image",
    });
    expect(classifySourceFile(file("payslip.pdf", "application/pdf"))).toEqual({
      ok: true,
      kind: "pdf",
    });
    expect(classifySourceFile(file("payslip.heic", ""))).toEqual({ ok: true, kind: "image" });
  });

  it("rejects unsupported and mismatched declared types", () => {
    expect(classifySourceFile(file("payslip.jpg", "application/octet-stream"))).toEqual({
      ok: false,
      error: "unsupported_media_type",
    });
    expect(classifySourceFile(null)).toEqual({ ok: false, error: "file_required" });
  });

  it("permits exactly 10 MiB and rejects anything larger", () => {
    expect(classifySourceFile(file("payslip.jpg", "image/jpeg", MAX_CLIENT_UPLOAD_BYTES)).ok).toBe(
      true,
    );
    expect(
      classifySourceFile(file("payslip.jpg", "image/jpeg", MAX_CLIENT_UPLOAD_BYTES + 1)),
    ).toEqual({
      ok: false,
      error: "file_too_large",
    });
  });
});

describe("image quality helpers", () => {
  it("gives flat pixels a lower variance than a high-edge sample", () => {
    const flat = pixels(5, 5, () => 128);
    const edges = pixels(5, 5, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));

    expect(laplacianVariance(flat, 5, 5)).toBe(0);
    expect(laplacianVariance(edges, 5, 5)).toBeGreaterThan(BLUR_VARIANCE_WARNING_THRESHOLD);
  });

  it("returns advisory resolution and blur warnings independently", () => {
    expect(qualityWarnings(MIN_RECOMMENDED_SHORT_EDGE - 1, 1000, 100)).toEqual(["low_resolution"]);
    expect(qualityWarnings(1000, 1000, BLUR_VARIANCE_WARNING_THRESHOLD - 1)).toEqual([
      "possible_blur",
    ]);
  });
});
