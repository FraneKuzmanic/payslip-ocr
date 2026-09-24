import type { SourceRegion } from "@payslip/shared";

/**
 * How much sharper than the fitted CSS size the page bitmap is rasterised.
 *
 * A PDF is vector, so it could be re-rasterised at every zoom level for perfect crispness. It
 * deliberately is not: the image path CSS-scales a fixed bitmap, and this feature exists to make a
 * PDF behave exactly like a photo. Rendering once at 2.5x buys legible text to roughly 250% zoom —
 * past which it softens the way a photo already does — without a render queue, in-flight
 * cancellation on every wheel tick, and the flicker that comes with them.
 */
export const RENDER_QUALITY = 2.5;

/**
 * Hard ceiling on the rasterised bitmap's width, in device pixels.
 *
 * Canvas memory is width x height x 4 bytes and mobile Safari discards a canvas that grows too
 * large, painting nothing at all. At this width an A4 portrait page costs roughly 2600 x 3676 x 4
 * bytes, about 38 MB — the practical limit worth spending on a phone.
 */
export const MAX_CANVAS_WIDTH = 2600;

/**
 * The scale to pass to pdf.js's `getViewport`, given the page's own unscaled width, the CSS width
 * it will be displayed at, and the device pixel ratio.
 *
 * Returns 0 when the viewport has not been measured yet, which the caller must read as "do not
 * render". Rendering at a guessed size would paint a blurry page that is never replaced, because
 * the real measurement arrives through a ResizeObserver that reports no change.
 */
export function renderScale(pageWidth: number, cssWidth: number, devicePixelRatio: number): number {
  if (pageWidth <= 0 || cssWidth <= 0) return 0;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const target = Math.min(cssWidth * dpr * RENDER_QUALITY, MAX_CANVAS_WIDTH);
  return target / pageWidth;
}

/**
 * The page a focused field's outline lives on, or `fallback` when the field has no region.
 *
 * This is the auto-jump rule. Without it a highlight can exist on a page the user is not looking
 * at, which reads as the feature being broken rather than as the value being on page two.
 */
export function pageForField(
  regions: readonly SourceRegion[] | undefined,
  field: string | null,
  fallback: number,
): number {
  if (regions === undefined || field === null) return fallback;
  return regions.find((region) => region.fields.includes(field))?.page ?? fallback;
}
