import type { RequestHandler } from "express";
import multer from "multer";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 0 },
  // Busboy defaults multipart parameters to latin1, which mangles Croatian filenames.
  defParamCharset: "utf8",
}).single("file");

export const sourceFileUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(413, "file_too_large"));
        return;
      }
      if (
        error.code === "LIMIT_UNEXPECTED_FILE" ||
        error.code === "LIMIT_FILE_COUNT" ||
        error.code === "LIMIT_FIELD_COUNT"
      ) {
        next(new HttpError(400, "file_required"));
        return;
      }
    }

    next(error);
  });
};
