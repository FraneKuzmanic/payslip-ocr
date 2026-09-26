import {
  EXTRACTION_FAILURE_REASONS,
  PAYSLIP_STATUSES,
  TABLES_STATUSES,
  WARNING_CODES,
} from "@payslip/shared";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

const LOCALES = [
  ["en", en],
  ["hr", hr],
] as const;

/**
 * Statuses, failure reasons and warnings are rendered from their code (Task 07 D11, Task 09 D20),
 * which the translation-key scan cannot see. This keeps a new shared code from becoming raw UI text,
 * as `uploadErrors` does.
 */
const GROUPS = [
  ["payslipStatus", PAYSLIP_STATUSES],
  ["tablesStatus", TABLES_STATUSES],
  ["failureReason", EXTRACTION_FAILURE_REASONS],
  ["warnings", WARNING_CODES],
] as const;

const CASES = LOCALES.flatMap(([name, locale]) =>
  GROUPS.map(
    ([group, codes]) => [name, group, locale[group] as Record<string, string>, codes] as const,
  ),
);

describe("status, failure-reason and warning copy", () => {
  it.each(CASES)("%s has a non-empty %s message for every code", (_name, group, copy, codes) => {
    for (const code of codes) {
      const message: string | undefined = copy[code];
      expect(message, `missing ${group}.${code}`).toBeDefined();
      expect(message?.trim(), `empty ${group}.${code}`).not.toBe("");
    }
  });

  it.each(CASES)("%s has no %s message without a matching code", (_name, _group, copy, codes) => {
    const known = new Set<string>(codes);
    expect(Object.keys(copy).filter((key) => !known.has(key))).toEqual([]);
  });
});
