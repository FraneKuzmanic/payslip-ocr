import { describe, expect, it } from "vitest";
import {
  canonicalPayslipFieldsSchema,
  neoporeziviPrimitakSchema,
  obustavaSchema,
  payComponentSchema,
} from "@payslip/shared";
import en from "../i18n/locales/en.json";
import hr from "../i18n/locales/hr.json";
import { SECTION_LABEL_KEYS, fieldLabel } from "./regionSections";

const LOCALES = [
  ["en", en],
  ["hr", hr],
] as const;

const TABLES = {
  payComponents: payComponentSchema,
  obustave: obustavaSchema,
  neoporeziviPrimici: neoporeziviPrimitakSchema,
} as const;

/** Every canonical path a region or form field can name, one row per cell column. */
const PATHS = [
  ...Object.keys(canonicalPayslipFieldsSchema.shape).filter((name) => !(name in TABLES)),
  ...Object.entries(TABLES).flatMap(([table, schema]) =>
    Object.keys(schema.shape).map((column) => `${table}.0.${column}`),
  ),
];

function resolve(locale: object, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      locale,
    );
}

/**
 * Field labels are chosen from a path at runtime (Task 08 D9), which the translation-key scan
 * cannot see. This keeps a new canonical field from becoming a raw key in either language.
 */
describe("field and section labels", () => {
  it.each(LOCALES)("%s labels every canonical scalar and column", (_name, locale) => {
    expect(PATHS).toHaveLength(36);
    for (const path of PATHS) {
      const label = fieldLabel(path);
      expect(label, path).not.toBeNull();
      const copy = resolve(locale, label?.key ?? "");
      expect(typeof copy === "string" && copy.trim() !== "", path).toBe(true);
    }
  });

  it.each(LOCALES)("%s names all seven sections", (_name, locale) => {
    for (const key of Object.values(SECTION_LABEL_KEYS)) {
      const copy = resolve(locale, key);
      expect(typeof copy === "string" && copy.trim() !== "", key).toBe(true);
    }
  });
});
