import { describe, expect, it } from "vitest";
import {
  canonicalPayslipFieldsSchema,
  neoporeziviPrimitakSchema,
  obustavaSchema,
  payComponentSchema,
} from "@payslip/shared";
import { SECTION_COLOURS, fieldLabel, sectionOf } from "./regionSections";

const TABLES = {
  payComponents: payComponentSchema,
  obustave: obustavaSchema,
  neoporeziviPrimici: neoporeziviPrimitakSchema,
} as const;

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("region sections", () => {
  it.each([
    ["employerOib", "employer"],
    ["employeeName", "employee"],
    ["paymentDate", "period"],
    ["iznosZaIsplatu", "reconciliation"],
    ["payComponents.2.iznos", "payComponents"],
    ["obustave.0.vjerovnik", "obustave"],
    ["neoporeziviPrimici.1.naziv", "neoporeziviPrimici"],
    ["unknown", null],
    ["toString", null],
    ["payComponents.x.iznos", null],
    ["obustave.0.constructor", null],
  ])("maps %s", (field, section) => {
    expect(sectionOf(field)).toBe(section);
  });

  it("labels a cell by its column and its 1-based row", () => {
    expect(fieldLabel("payComponents.2.iznos")).toEqual({
      key: "review.columns.payComponents.iznos",
      section: "payComponents",
      row: 3,
    });
    expect(fieldLabel("netoPlaca")).toEqual({
      key: "review.fields.netoPlaca",
      section: "reconciliation",
      row: null,
    });
  });

  it("places and labels every canonical scalar", () => {
    const scalars = Object.keys(canonicalPayslipFieldsSchema.shape).filter(
      (name) => !(name in TABLES),
    );
    expect(scalars).toHaveLength(25);
    for (const name of scalars) {
      expect(fieldLabel(name), name).toMatchObject({ key: `review.fields.${name}`, row: null });
    }
  });

  it("labels every column of every line-item table", () => {
    for (const [table, schema] of Object.entries(TABLES)) {
      for (const column of Object.keys(schema.shape)) {
        expect(fieldLabel(`${table}.0.${column}`), `${table}.${column}`).toEqual({
          key: `review.columns.${table}.${column}`,
          section: table,
          row: 1,
        });
      }
    }
  });

  // WCAG 1.4.11: an outline is a graphical object needed to understand the content (D4).
  it("uses seven distinct colours, each at least 3:1 against white", () => {
    const colours = Object.values(SECTION_COLOURS);
    expect(new Set(colours).size).toBe(7);
    for (const colour of colours) {
      expect((1 + 0.05) / (luminance(colour) + 0.05), colour).toBeGreaterThanOrEqual(3);
    }
  });
});
