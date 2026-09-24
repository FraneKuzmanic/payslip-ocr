export const MAX_CLIENT_UPLOAD_BYTES = 10 * 1024 * 1024;
export const QUALITY_SAMPLE_MAX_EDGE = 256;
export const MIN_RECOMMENDED_SHORT_EDGE = 800;
export const BLUR_VARIANCE_WARNING_THRESHOLD = 80;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "heic", "heif"]);

export const CAMERA_ACCEPT =
  "image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif";
export const FILE_ACCEPT = `${CAMERA_ACCEPT},application/pdf,.pdf`;

export type SourceFileKind = "image" | "pdf";
export type SourceFileError = "file_required" | "file_too_large" | "unsupported_media_type";
export type QualityWarning = "low_resolution" | "possible_blur";

export type SourceFileClassification =
  { ok: true; kind: SourceFileKind } | { ok: false; error: SourceFileError };

export interface ImageAnalysis {
  width: number;
  height: number;
  blurVariance: number;
  warnings: QualityWarning[];
}

export class PreviewUnavailableError extends Error {
  constructor() {
    super("preview_unavailable");
    this.name = "PreviewUnavailableError";
  }
}

function extensionFor(name: string): string | undefined {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === name.toLowerCase() ? undefined : extension;
}

export function classifySourceFile(file: File | null | undefined): SourceFileClassification {
  if (!file) return { ok: false, error: "file_required" };
  if (file.size > MAX_CLIENT_UPLOAD_BYTES) return { ok: false, error: "file_too_large" };

  if (IMAGE_MIME_TYPES.has(file.type)) return { ok: true, kind: "image" };
  if (file.type === "application/pdf") return { ok: true, kind: "pdf" };
  if (file.type !== "") return { ok: false, error: "unsupported_media_type" };

  const extension = extensionFor(file.name);
  if (extension && IMAGE_EXTENSIONS.has(extension)) return { ok: true, kind: "image" };
  if (extension === "pdf") return { ok: true, kind: "pdf" };
  return { ok: false, error: "unsupported_media_type" };
}

export function laplacianVariance(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  const grayscaleAt = (pixel: number) => {
    const offset = pixel * 4;
    return (
      0.299 * (data[offset] ?? 0) +
      0.587 * (data[offset + 1] ?? 0) +
      0.114 * (data[offset + 2] ?? 0)
    );
  };
  const values: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = grayscaleAt(y * width + x);
      const north = grayscaleAt((y - 1) * width + x);
      const south = grayscaleAt((y + 1) * width + x);
      const west = grayscaleAt(y * width + x - 1);
      const east = grayscaleAt(y * width + x + 1);
      values.push(4 * center - north - south - west - east);
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

export function qualityWarnings(
  width: number,
  height: number,
  blurVariance: number,
): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (Math.min(width, height) < MIN_RECOMMENDED_SHORT_EDGE) warnings.push("low_resolution");
  if (blurVariance < BLUR_VARIANCE_WARNING_THRESHOLD) warnings.push("possible_blur");
  return warnings;
}

export async function analyzeSourceImage(file: File): Promise<ImageAnalysis> {
  const url = URL.createObjectURL(file);
  const image = new Image();

  try {
    image.src = url;
    await image.decode();

    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, QUALITY_SAMPLE_MAX_EDGE / longestEdge);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PreviewUnavailableError();

    context.drawImage(image, 0, 0, width, height);
    const blurVariance = laplacianVariance(
      context.getImageData(0, 0, width, height).data,
      width,
      height,
    );
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      blurVariance,
      warnings: qualityWarnings(image.naturalWidth, image.naturalHeight, blurVariance),
    };
  } catch {
    throw new PreviewUnavailableError();
  } finally {
    URL.revokeObjectURL(url);
  }
}
