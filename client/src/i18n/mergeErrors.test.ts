import { MERGE_ERROR_CODES } from "@payslip/shared";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

const LOCALES = [
  ["en", en],
  ["hr", hr],
] as const;

/** Merge refusals are rendered from their code (plan 11 D10), which a literal-key scan cannot see. */
describe("merge error messages", () => {
  it.each(LOCALES)("%s has a non-empty message for every merge error code", (_name, locale) => {
    for (const code of [...MERGE_ERROR_CODES, "network"] as const) {
      const message: string | undefined = locale.merge.errors[code];
      expect(message, `missing merge.errors.${code}`).toBeDefined();
      expect(message?.trim(), `empty merge.errors.${code}`).not.toBe("");
    }
  });

  it.each(LOCALES)("%s has no merge error message without a matching code", (_name, locale) => {
    const known = new Set<string>([...MERGE_ERROR_CODES, "network"]);
    expect(Object.keys(locale.merge.errors).filter((key) => !known.has(key))).toEqual([]);
  });
});
