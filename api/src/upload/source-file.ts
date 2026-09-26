import { fileTypeFromBuffer } from "file-type";
import "multer";
import { PDFDocument } from "@cantoo/pdf-lib";
import { SOURCE_CONTENT_TYPES, type SourceContentType } from "@payslip/shared";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";

export interface SourceFile {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
  readonly originalFilename: string;
  readonly byteSize: number;
  /** Measured from the bytes: a PDF's page count, 1 for an image. */
  readonly pageCount: number;
}

export async function validateSourceFile(
  file: Express.Multer.File | undefined,
): Promise<SourceFile> {
  if (file === undefined) throw new HttpError(400, "file_required");

  const detected = await fileTypeFromBuffer(file.buffer);
  if (
    detected === undefined ||
    !SOURCE_CONTENT_TYPES.includes(detected.mime as SourceContentType)
  ) {
    throw new HttpError(415, "unsupported_media_type");
  }

  const contentType = detected.mime as SourceContentType;
  const pageCount = contentType === "application/pdf" ? await validatePdf(file.buffer) : 1;

  return {
    bytes: file.buffer,
    contentType,
    originalFilename: normalizeFilename(file.originalname),
    byteSize: file.size,
    pageCount,
  };
}

async function validatePdf(bytes: Buffer): Promise<number> {
  try {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (document.isEncrypted && (await requiresPassword(bytes))) {
      throw new HttpError(422, "pdf_encrypted");
    }
    const pageCount = document.getPageCount();
    if (pageCount > config.MAX_PDF_PAGES) throw new HttpError(422, "pdf_too_many_pages");
    return pageCount;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "pdf_unreadable");
  }
}

/**
 * `pdf_encrypted` means "cannot be opened without a password". A permissions-only PDF carries an
 * `/Encrypt` entry too, but it opens with no password in every reader and in the extraction
 * service, and payroll software emits them (golden-set B01). pdf-lib loads with
 * `ignoreEncryption` and does not answer that question, so pdf.js, the reader the client renders
 * with, answers it. Anything else it cannot open throws,
 * and the caller reports it as `pdf_unreadable`.
 */
async function requiresPassword(bytes: Buffer): Promise<boolean> {
  const { getDocument, PasswordException } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // A copy: pdf.js takes ownership of the buffer it is given.
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    await task.promise;
    return false;
  } catch (error) {
    if (error instanceof PasswordException) return true;
    throw error;
  } finally {
    await task.destroy();
  }
}

function normalizeFilename(originalFilename: string): string {
  const trimmed = originalFilename.trim();
  return trimmed === "" ? "payslip" : trimmed.slice(0, 255);
}
