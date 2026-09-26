import type { Bounds, Viewport } from "./sourceZoom";

function centred(size: number, surface: number, centre: number) {
  const offset = size / 2 - centre * surface;
  return surface > size ? Math.max(size - surface, Math.min(0, offset)) : offset;
}

/** Magnifies one printed line without exposing an empty edge of the page (Task 10 D6). */
export function stripView(bounds: Bounds, ratio: number, box: Viewport) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0 || ratio <= 0 || box.width <= 0 || box.height <= 0) return null;
  const surfaceWidth = Math.min(
    (0.45 * box.height * ratio) / height,
    (0.9 * box.width) / width,
    8 * box.width,
  );
  const surfaceHeight = surfaceWidth / ratio;
  return {
    surfaceWidth,
    x: centred(box.width, surfaceWidth, (bounds.minX + bounds.maxX) / 2),
    y: centred(box.height, surfaceHeight, (bounds.minY + bounds.maxY) / 2),
  };
}

export function isObscured(
  rect: { top: number; bottom: number },
  visibleTop: number,
  visibleBottom: number,
) {
  return rect.top < visibleTop || rect.bottom > visibleBottom;
}

/** Chips beyond the last completely visible tab; the badge stays on that visible tab. */
export function overflowAfter(
  visible: readonly boolean[],
): { index: number; count: number } | null {
  const index = visible.lastIndexOf(true);
  return index < 0 || index === visible.length - 1
    ? null
    : { index, count: visible.length - index - 1 };
}
