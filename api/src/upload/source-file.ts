import { fileTypeFromBuffer } from "file-type";
import "multer";
import { PDFDocument } from "pdf-lib";
import { SOURCE_CONTENT_TYPES, type SourceContentType } from "@payslip/shared";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";

export interface SourceFile {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
  readonly originalFilename: string;
  readonly byteSize: number;
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
  if (contentType === "application/pdf") await validatePdf(file.buffer);

  return {
    bytes: file.buffer,
    contentType,
    originalFilename: normalizeFilename(file.originalname),
    byteSize: file.size,
  };
}

async function validatePdf(bytes: Buffer): Promise<void> {
  try {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (document.isEncrypted) throw new HttpError(422, "pdf_encrypted");
    if (document.getPageCount() > config.MAX_PDF_PAGES) {
      throw new HttpError(422, "pdf_too_many_pages");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "pdf_unreadable");
  }
}

function normalizeFilename(originalFilename: string): string {
  const trimmed = originalFilename.trim();
  return trimmed === "" ? "payslip" : trimmed.slice(0, 255);
}
