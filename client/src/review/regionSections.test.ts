import { describe, expect, it } from "vitest";
import { sectionOf } from "./regionSections";

describe("region sections", () => {
  it.each([
    ["sellerName", "seller"],
    ["buyerOib", "buyer"],
    ["total", "document"],
    ["vatBreakdown.2.vatAmount", "vat"],
    ["items.4.unitPrice", "items"],
    ["unknown", null],
  ])("maps %s", (field, section) => {
    expect(sectionOf(field)).toBe(section);
  });
});
