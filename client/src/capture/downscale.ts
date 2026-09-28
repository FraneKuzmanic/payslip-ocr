export const DOWNSCALE_MAX_BYTES = 4 * 1024 * 1024;
export const DOWNSCALE_LONG_EDGE = 3_000;
const JPEG_QUALITY = 0.82;

/**
 * The size an image is re-encoded at, or `null` to upload it untouched (Task 14 D22). Only a long
 * edge over 3,000 px is scaled down, because the long edge is what keeps text legible when zoomed;
 * a file over the byte cap is otherwise re-encoded at its own size. Accuracy was measured on
 * original bytes, so keeping more pixels moves the upload toward what was measured.
 */
export function downscaleTarget(
  width: number,
  height: number,
  bytes: number,
): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= DOWNSCALE_LONG_EDGE && bytes <= DOWNSCALE_MAX_BYTES) return null;
  const scale = Math.min(1, DOWNSCALE_LONG_EDGE / longEdge);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function downscaleSourceImage(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;

  try {
    const url = URL.createObjectURL(file);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("image decode failed")), {
        once: true,
      });
      image.src = url;
    });
    URL.revokeObjectURL(url);

    const target = downscaleTarget(image.naturalWidth, image.naturalHeight, file.size);
    if (target === null) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (blob === null) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}
