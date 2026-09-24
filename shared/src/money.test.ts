import { describe, expect, it } from "vitest";
import {
  AMOUNT_PATTERN,
  addAmounts,
  amountsEqual,
  compareAmounts,
  formatAmount,
  isAmount,
  parseAmount,
} from "./money.js";

const NBSP = "\u00A0";
const NARROW_NBSP = "\u202F";

describe("parseAmount", () => {
  it.each([
    // The six cases named in the roadmap definition of done.
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["100", "100"],
    ["", null],
    [null, null],
    ["9007199254740993.01", "9007199254740993.01"],

    // Scale must survive: PRD §6.4 and Task 11 both depend on 100.50 staying 100.50.
    ["100,50", "100.50"],
    ["0,00", "0.00"],

    // Whitespace, including the two non-breaking spaces that appear in OCR text and in
    // Intl output.
    ["1 234,56", "1234.56"],
    [`1${NBSP}234,56`, "1234.56"],
    [`1${NARROW_NBSP}234,56`, "1234.56"],

    // Currency stripping. "1234.56 EUR" is the case that breaks if whitespace is
    // collapsed before the currency token is removed.
    ["12,50 €", "12.50"],
    ["€ 1.234,56", "1234.56"],
    ["1234.56 EUR", "1234.56"],
    ["1.234,56 EUR", "1234.56"],

    // Croatian kuna: pre-2023 documents use the abbreviation "kn", not only the ISO code HRK.
    ["13.00 kn", "13.00"],
    ["13,00 KN", "13.00"],

    // More than one thousands group.
    ["1.234.567,89", "1234567.89"],
    ["1,234,567.89", "1234567.89"],

    // Ambiguous: one separator, exactly three digits after it — rejected, not guessed
    // (Task 02 DoD).
    ["1.234", null],
    ["1,234", null],
    ["12.345", null],
    ["123.456", null],

    // Four digits before the separator cannot be a thousands group, so it stays a decimal.
    ["1234.567", "1234.567"],

    // A real OCR misread: G01's netoPlaca as the provider returned it.
    ["1.219.08", null],

    // One separator that cannot be a thousands group.
    ["1,5", "1.5"],
    ["1.5", "1.5"],

    // Negatives in the three notations documents use.
    ["-12,50", "-12.50"],
    ["12,50-", "-12.50"],
    ["(12,50)", "-12.50"],

    // Unreadable input is a missing value, never a guess (PRD §7.7).
    ["abc", null],
    ["1.2.3", null],
    ["1,23,45", null],
    ["1e5", null],
    [undefined, null],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(["1.234,56", "1234,56", "1 234,56", "1234.56"])(
    "handles %j identically (Task 02 DoD)",
    (raw) => {
      expect(parseAmount(raw)).toBe("1234.56");
    },
  );

  it("never throws, whatever it is handed", () => {
    for (const raw of ["", ".", ",", "-", "()", "€", "--1", "1..2", ",50", "12,"]) {
      expect(() => parseAmount(raw)).not.toThrow();
    }
  });

  it("produces output that is always canonical", () => {
    for (const raw of ["1.234,56", "100", "0,00", "-12,50", "1.234.567,89"]) {
      const parsed = parseAmount(raw);
      expect(parsed).not.toBeNull();
      expect(parsed).toMatch(AMOUNT_PATTERN);
    }
  });
});

describe("isAmount", () => {
  it.each(["0", "100", "100.50", "-12.50", "9007199254740993.01"])("accepts %j", (value) => {
    expect(isAmount(value)).toBe(true);
  });

  it.each(["1.234,56", "1,234.56", "", ".5", "5.", "1e5", "abc", 100, null, undefined])(
    "rejects %j",
    (value) => {
      expect(isAmount(value)).toBe(false);
    },
  );
});

describe("addAmounts", () => {
  it("is exact where a JS float is not", () => {
    // 0.1 + 0.2 === 0.30000000000000004 as floats.
    expect(addAmounts("0.1", "0.2")).toBe("0.3");
    expect(addAmounts("80.65", "20.16")).toBe("100.81");
  });

  it("keeps the wider of the two scales, so a trailing zero is not lost", () => {
    expect(addAmounts("100.50", "0.00")).toBe("100.50");
    expect(addAmounts("100", "0.50")).toBe("100.50");
    expect(addAmounts("1", "2")).toBe("3");
  });

  it("throws if handed a JS number, because Big.strict is on", () => {
    // @ts-expect-error — the point of the test is that the runtime refuses a float even
    // when a caller has defeated the type system.
    expect(() => addAmounts(0.1, "0.2")).toThrow();
  });
});

describe("compareAmounts and amountsEqual", () => {
  it("compares numerically, ignoring scale", () => {
    expect(amountsEqual("100.50", "100.5")).toBe(true);
    expect(compareAmounts("100.50", "100.5")).toBe(0);
  });

  it("orders correctly", () => {
    expect(compareAmounts("1.10", "1.09")).toBe(1);
    expect(compareAmounts("1.09", "1.10")).toBe(-1);
    expect(compareAmounts("-1.00", "1.00")).toBe(-1);
  });

  it("distinguishes values a float would collapse", () => {
    expect(amountsEqual("9007199254740993", "9007199254740992")).toBe(false);
  });
});

describe("formatAmount", () => {
  it("formats Croatian currency", () => {
    // hr-HR separates the amount from the symbol with U+00A0, not a plain space.
    expect(formatAmount("1234.56", { locale: "hr-HR", currency: "EUR" })).toBe(`1.234,56${NBSP}€`);
  });

  it("formats English currency", () => {
    expect(formatAmount("1234.56", { locale: "en-US", currency: "EUR" })).toBe("€1,234.56");
  });

  it("formats without a currency when none is known", () => {
    expect(formatAmount("1234.56", { locale: "hr-HR" })).toBe("1.234,56");
    expect(formatAmount("1234.56", { locale: "hr-HR", currency: null })).toBe("1.234,56");
  });

  it("keeps precision a float would destroy", () => {
    expect(formatAmount("12345678901234567890.99", { locale: "en-US" })).toBe(
      "12,345,678,901,234,567,890.99",
    );
  });

  it("returns null for a missing amount rather than inventing a zero", () => {
    expect(formatAmount(null, { locale: "hr-HR", currency: "EUR" })).toBeNull();
  });
});
