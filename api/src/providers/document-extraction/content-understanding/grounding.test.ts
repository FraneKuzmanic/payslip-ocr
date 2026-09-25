import { describe, expect, it } from "vitest";
import { groundingKey, isGrounded as isGroundedIn, keyPages, surfaceForms } from "./grounding.js";

/** Grounds against raw page words, keying them as the mapper does. */
function isGrounded(forms: readonly string[], pages: string[][], maxRun?: number): boolean {
  return isGroundedIn(forms, keyPages(pages), maxRun);
}

describe("isGrounded", () => {
  it.each(["1.801,77", "2.298,97"])("grounds the printed amount %s", (amount) => {
    expect(isGrounded([amount], [["NETO", amount, "EUR"]])).toBe(true);
  });

  it("grounds a multi-word name split across words", () => {
    expect(isGrounded(["Ivana Horvat"], [["Radnik:", "IVANA", "HORVAT", "OIB"]])).toBe(true);
  });

  it("grounds a value whose diacritics the OCR dropped", () => {
    expect(isGrounded(["NETO PLAĆU"], [["NA", "NETO", "PLACU"]])).toBe(true);
  });

  it("grounds a thirteen-word value by default, and not with a run of twelve", () => {
    const words =
      "SINDIKALNA ČLANARINA - RATA KAO POSTOTAK NA NETO PLAĆU, BEZ KONTROLE SALDA X".split(" ");
    const printed = words.slice(0, 13).join(" ");
    expect(words.slice(0, 13)).toHaveLength(13);
    expect(isGrounded([printed], [words])).toBe(true);
    expect(isGrounded([printed], [words], 12)).toBe(false);
  });

  it("never matches a run across two pages", () => {
    expect(isGrounded(["IVANA HORVAT"], [["IVANA"], ["HORVAT"]])).toBe(false);
  });

  it("does not ground a value that is not on the page", () => {
    expect(isGrounded(["2.033,32"], [["1.801,77", "EUR"]])).toBe(false);
  });
});

describe("surfaceForms", () => {
  it("lets a normalised payment date meet its printed form", () => {
    expect(isGrounded(surfaceForms("2025-07-10"), [["Datum", "isplate:", "10.07.2025"]])).toBe(
      true,
    );
    expect(isGrounded(surfaceForms("2025-06-06"), [["6.06.2025"]])).toBe(true);
    expect(isGrounded(surfaceForms("2025-06-10"), [["10.6.25."]])).toBe(true);
  });

  it("lets an OIB meet its HR-prefixed printed form", () => {
    expect(isGrounded(surfaceForms("00000000010"), [["OIB:", "HR00000000010"]])).toBe(true);
  });

  it("adds no forms for an amount, which comes back as printed", () => {
    expect(surfaceForms("1200.00")).toEqual(["1200.00"]);
  });

  it("grounds a value longer than 200 characters", () => {
    const words = Array.from({ length: 30 }, (_, index) => `RIJEC${index}ABCDEFG`);
    expect(isGrounded([words.join(" ")], [words])).toBe(true);
  });

  it("does not ground a different date", () => {
    expect(isGrounded(surfaceForms("2025-07-11"), [["10.07.2025"]])).toBe(false);
  });
});

describe("groundingKey", () => {
  it("ignores whitespace, separators, case, diacritics and đ", () => {
    expect(groundingKey("Đurđa  Č. ŠIĆ,")).toBe("durdacsic");
  });
});
