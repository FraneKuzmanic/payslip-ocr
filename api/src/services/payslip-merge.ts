import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import exifr from "exifr";
import convert from "heic-convert";
import type { SourceContentType } from "@payslip/shared";

/**
 * Builds the combined PDF a merge re-extracts (PRD §7.8, plan 11 D9).
 *
 * - **The pdf-lib fork.** pdf-lib 1.17.1 copies the pages of a permissions-only PDF (golden-set
 *   B01: `/Encrypt` with an empty user password) with their content streams still encrypted, so
 *   the result has no readable text. `@cantoo/pdf-lib` decrypts it with the empty password first
 *   (D1). Every source passed upload validation, so none needs a real password.
 * - **A4 geometry.** An image page's long edge is declared as A4's 842 pt, with the image's full
 *   pixel resolution kept. At one pixel per point a 4000 px photo would be a 55-inch page.
 * - **EXIF becomes `/Rotate`.** A JPEG drawn onto a PDF page ignores its EXIF orientation, while
 *   the extraction service and pdf.js both honour a page's `/Rotate` (history/08).
 * - **HEIC is converted, not rotated.** pdf-lib embeds only JPEG and PNG. The converted JPEG
 *   carries no EXIF and is already upright (plan 11, A02.heic probe).
 */

export interface MergeSource {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

export interface CombinedSource {
  readonly bytes: Buffer;
  readonly pageCount: number;
}

/** A source that could not be loaded, converted or embedded: `422 merge_source_unreadable`. */
export class MergeSourceError extends Error {
  constructor(cause: unknown) {
    super("A merge source could not be read", { cause });
    this.name = "MergeSourceError";
  }
}

/** A4's long edge, in points. */
const PAGE_LONG_EDGE = 842;

/** EXIF orientations a phone camera writes, as page rotation. Mirrored ones stay as drawn. */
const EXIF_ROTATION: Readonly<Record<number, number>> = { 3: 180, 6: 90, 8: 270 };

/** `sources` are in page order. Sequential, so at most one HEIC is decoded at a time (D2). */
export async function combineSources(sources: readonly MergeSource[]): Promise<CombinedSource> {
  const combined = await PDFDocument.create();
  for (const source of sources) {
    try {
      if (source.contentType === "application/pdf") await addPdf(combined, source.bytes);
      else await addImage(combined, source);
    } catch (error) {
      throw new MergeSourceError(error);
    }
  }
  return { bytes: Buffer.from(await combined.save()), pageCount: combined.getPageCount() };
}

async function addPdf(combined: PDFDocument, bytes: Buffer): Promise<void> {
  const plain = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const source = plain.isEncrypted ? await PDFDocument.load(bytes, { password: "" }) : plain;
  // Each copied page keeps its size and its `/Rotate`.
  for (const page of await combined.copyPages(source, source.getPageIndices())) {
    combined.addPage(page);
  }
}

async function addImage(combined: PDFDocument, source: MergeSource): Promise<void> {
  const image =
    source.contentType === "image/png"
      ? await combined.embedPng(source.bytes)
      : await combined.embedJpg(await jpegBytes(source));
  const scale = PAGE_LONG_EDGE / Math.max(image.width, image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const page = combined.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  if (source.contentType === "image/jpeg") {
    const rotation = EXIF_ROTATION[(await exifr.orientation(source.bytes)) ?? 1];
    if (rotation !== undefined) page.setRotation(degrees(rotation));
  }
}

async function jpegBytes(source: MergeSource): Promise<Buffer> {
  if (source.contentType !== "image/heic" && source.contentType !== "image/heif") {
    return source.bytes;
  }
  return Buffer.from(await convert({ buffer: source.bytes, format: "JPEG", quality: 0.92 }));
}
