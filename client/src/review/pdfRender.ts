import type { SourceRegion } from "@payslip/shared";

/**
 * How much sharper than the fitted CSS size the page bitmap is rasterised at fit.
 *
 * 2.5x keeps text legible to roughly 250% zoom from the one bitmap drawn when the page opens. Past
 * that the page is redrawn at the settled zoom (Task 14 D18), because a photo-like CSS-scaled bitmap
 * left A01.pdf unreadable below ~500% on a laptop.
 */
export const RENDER_QUALITY = 2.5;

/**
 * The most pixels one page bitmap may hold (Task 14 D18). Canvas memory is width x height x 4
 * bytes, and a canvas past the browser's limit paints nothing at all.
 *
 * The phone value is the largest bitmap the viewer drew before Task 14, an A4 page 2,600 px wide
 * (about 9.56 MP), which the product owner's Android phone rendered. WebKit's per-canvas limit
 * (16,777,216 px) is higher, but a redraw holds two canvases at once, and pdf.js itself caps iOS
 * and Android at 5,242,880 px (`pdf_viewer.mjs`). A phone's fit render stays under this cap
 * (Task 14 review). The desktop value is pdf.js's own default `maxCanvasPixels`, 2^25.
 */
export const PHONE_PIXEL_BUDGET = 9_560_000;
export const DESKTOP_PIXEL_BUDGET = 33_554_432;

/**
 * The scale to pass to pdf.js's `getViewport`, given the page's own unscaled size, the CSS width
 * it will be displayed at at zoom 1, the device pixel ratio and the settled zoom.
 *
 * The target width is `cssWidth x dpr x max(zoom, RENDER_QUALITY)`, so nothing is redrawn until the
 * zoom passes the fitted quality, reduced until the bitmap's area fits `budget`.
 *
 * Returns 0 when the viewport has not been measured yet, which the caller must read as "do not
 * render". Rendering at a guessed size would paint a blurry page that is never replaced, because
 * the real measurement arrives through a ResizeObserver that reports no change.
 */
export function renderScale(
  pageWidth: number,
  pageHeight: number,
  cssWidth: number,
  devicePixelRatio: number,
  zoom = 1,
  budget = DESKTOP_PIXEL_BUDGET,
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || cssWidth <= 0) return 0;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const wanted = cssWidth * dpr * Math.max(zoom, RENDER_QUALITY);
  // width x (width x pageHeight / pageWidth) <= budget
  const widest = Math.sqrt((budget * pageWidth) / pageHeight);
  return Math.min(wanted, widest) / pageWidth;
}

/** Whether a bitmap `currentWidth` px wide is far enough from the target to be worth redrawing. */
export function needsRedraw(currentWidth: number, targetWidth: number): boolean {
  if (currentWidth <= 0) return targetWidth > 0;
  return Math.abs(targetWidth - currentWidth) / currentWidth > 0.01;
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
