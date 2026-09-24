export const DOWNSCALE_MAX_PIXELS = 2_000_000;
export const DOWNSCALE_MAX_BYTES = 1.5 * 1024 * 1024;
export const DOWNSCALE_LONG_EDGE = 1_600;
const JPEG_QUALITY = 0.82;

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

    if (
      image.naturalWidth * image.naturalHeight <= DOWNSCALE_MAX_PIXELS &&
      file.size <= DOWNSCALE_MAX_BYTES
    )
      return file;

    const scale = Math.min(
      1,
      DOWNSCALE_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
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
