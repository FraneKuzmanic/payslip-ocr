import { UPLOAD_ERROR_CODES } from "@payslip/shared";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

const LOCALES = [
  ["en", en],
  ["hr", hr],
] as const;

/**
 * Upload failures will be rendered from their code, which Phase 6.5 cannot discover because its
 * translation-key scan only sees literals. This prevents a new API error code becoming raw UI text.
 */
describe("upload error messages", () => {
  it.each(LOCALES)("%s has a non-empty message for every upload error code", (_name, locale) => {
    for (const code of UPLOAD_ERROR_CODES) {
      const message: string | undefined = locale.upload[code];
      expect(message, `missing upload.${code}`).toBeDefined();
      expect(message?.trim(), `empty upload.${code}`).not.toBe("");
    }
  });

  it.each(LOCALES)("%s has no upload message without a matching code", (_name, locale) => {
    const known = new Set<string>(UPLOAD_ERROR_CODES);
    expect(Object.keys(locale.upload).filter((key) => !known.has(key))).toEqual([]);
  });
});
