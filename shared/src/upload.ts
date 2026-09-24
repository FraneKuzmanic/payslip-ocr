import { z } from "zod";

/**
 * A Source File is one still image or one PDF. HEIC and HEIF sequence types are absent because
 * they can contain multiple images, which conflicts with the one-payslip-per-Source-File rule.
 */
export const SOURCE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export const sourceContentTypeSchema = z.enum(SOURCE_CONTENT_TYPES);
export type SourceContentType = z.infer<typeof sourceContentTypeSchema>;

/**
 * These six codes match the validation rules implemented for source uploads. Adding codes before
 * adding a rule would create untranslated, unused vocabulary in both clients.
 */
export const UPLOAD_ERROR_CODES = [
  "file_required",
  "file_too_large",
  "unsupported_media_type",
  "pdf_encrypted",
  "pdf_too_many_pages",
  "pdf_unreadable",
] as const;

export const uploadErrorCodeSchema = z.enum(UPLOAD_ERROR_CODES);
export type UploadErrorCode = z.infer<typeof uploadErrorCodeSchema>;
