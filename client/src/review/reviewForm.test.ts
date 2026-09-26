import { describe, expect, it } from "vitest";
import { canonicalPayslipFieldsSchema, type CanonicalPayslipFields } from "@payslip/shared";
import {
  COLUMN_KINDS,
  SCALAR_KINDS,
  TABLE_FIELDS,
  columnKind,
  columnsOf,
  formatField,
  parseField,
  toFormValues,
  toPatch,
  validatorFor,
  type FormLanguage,
} from "./reviewForm";

// The reviewed golden set: every printed form the seven layouts produce, already canonical.
const fixtures = import.meta.glob<Record<string, unknown>>(
  "../../../.agents/fixtures/expected/*.json",
  { eager: true, import: "default" },
);
const CANONICAL_KEYS = Object.keys(canonicalPayslipFieldsSchema.shape);
const golden = Object.entries(fixtures).map(([path, fixture]) => {
  const picked = Object.fromEntries(
    Object.entries(fixture).filter(([key]) => CANONICAL_KEYS.includes(key)),
  );
  return [path.split("/").at(-1), canonicalPayslipFieldsSchema.parse(picked)] as const;
});

const LANGUAGES: FormLanguage[] = ["hr", "en"];

describe("the golden set round-trips through the form (Task 09 D12)", () => {
  it("finds all eleven fixtures, so an empty glob cannot pass vacuously", () => {
    expect(golden).toHaveLength(11);
  });

  it.each(
    LANGUAGES.flatMap((language) =>
      golden.map(([name, fields]) => [language, name, fields] as const),
    ),
  )("%s: %s parses back to every stored value", (language, _name, fields) => {
    const values = toFormValues(fields, language);
    for (const [name, kind] of Object.entries(SCALAR_KINDS)) {
      const stored = fields[name as keyof CanonicalPayslipFields];
      if (typeof stored !== "string") continue;
      const expected = kind === "text" ? stored.replaceAll(/\s*\n\s*/gu, " ") : stored;
      expect(parseField(kind, values[name as keyof typeof SCALAR_KINDS]), name).toEqual({
        ok: true,
        value: expected,
      });
    }
    for (const table of TABLE_FIELDS) {
      (fields[table] ?? []).forEach((row, index) => {
        for (const column of columnsOf(table)) {
          const stored = (row as Record<string, string | null | undefined>)[column];
          if (typeof stored !== "string") continue;
          const kind = columnKind(table, column);
          const expected = kind === "text" ? stored.replaceAll(/\s*\n\s*/gu, " ") : stored;
          const shown = (values[table][index] as Record<string, string>)[column] ?? "";
          expect(parseField(kind, shown), `${table}.${index}.${column}`).toEqual({
            ok: true,
            value: expected,
          });
        }
      });
    }
  });
});

describe("formatField", () => {
  it.each([
    ["amount", "2298.97", "2298,97", "2298.97"],
    ["amount", "100.50", "100,50", "100.50"],
    ["amount", "1234", "1234", "1234"],
    ["quantity", "0.135", "0,135", "0.135"],
    ["date", "2025-07-10", "10.07.2025", "2025-07-10"],
    ["period", "2025-07", "07/2025", "2025-07"],
    ["text", "SA\nSALDA", "SA SALDA", "SA SALDA"],
  ] as const)("shows a %s %s as %s in hr and %s in en", (kind, value, hr, en) => {
    expect(formatField(kind, value, "hr")).toBe(hr);
    expect(formatField(kind, value, "en")).toBe(en);
  });

  it("shows a missing value as an empty input", () => {
    expect(formatField("amount", null, "hr")).toBe("");
  });
});

describe("parseField and validatorFor", () => {
  it.each([
    ["amount", "1.234,56", "1234.56"],
    ["amount", "1234.56", "1234.56"],
    ["period", "07/2025", "2025-07"],
    ["period", "2025-07", "2025-07"],
    ["date", "10.07.2025", "2025-07-10"],
    ["text", "  Ana  ", "Ana"],
  ] as const)("reads a %s typed as %s as %s", (kind, raw, value) => {
    expect(parseField(kind, raw)).toEqual({ ok: true, value });
  });

  it("reads a blank input as null", () => {
    expect(parseField("amount", "  ")).toEqual({ ok: true, value: null });
  });

  it("refuses an ambiguous amount rather than guessing", () => {
    expect(parseField("amount", "1.234")).toEqual({ ok: false });
    expect(validatorFor("amount")("1.234")).toBe("review.errors.amount");
  });

  it.each([
    ["amount", "abc", "review.errors.amount"],
    ["quantity", "x", "review.errors.quantity"],
    ["date", "31.02.2025", "review.errors.date"],
    ["period", "13/2025", "review.errors.period"],
  ] as const)("names the %s error for %s", (kind, raw, key) => {
    expect(validatorFor(kind)(raw)).toBe(key);
  });

  it("never refuses text", () => {
    expect(validatorFor("text")("anything at all")).toBe(true);
  });
});

describe("toPatch (Task 09 D17)", () => {
  const fields: CanonicalPayslipFields = {
    employerName: "Tvrtka\nd.o.o.",
    netoPlaca: "1500.00",
    period: "2025-03",
    obustave: [
      { naziv: "KREDIT", vjerovnik: null, iznos: "100.00", ostatakSalda: null, brojRata: null },
    ],
    payComponents: [],
    neoporeziviPrimici: [],
  };

  it("sends only the dirty scalars, parsed", () => {
    const values = { ...toFormValues(fields, "hr"), netoPlaca: "1.501,00", period: "04/2025" };

    expect(toPatch(values, { netoPlaca: true, period: true }, true)).toEqual({
      netoPlaca: "1501.00",
      period: "2025-04",
    });
  });

  it("sends a blank scalar as null", () => {
    const values = { ...toFormValues(fields, "en"), netoPlaca: " " };

    expect(toPatch(values, { netoPlaca: true }, true)).toEqual({ netoPlaca: null });
  });

  it("sends a changed table whole, text joined, blank rows dropped", () => {
    const values = toFormValues(fields, "hr");
    values.obustave = [
      { ...values.obustave[0]!, iznos: "101,00" },
      { naziv: "", vjerovnik: "", iznos: "", ostatakSalda: "", brojRata: "" },
    ];

    expect(toPatch(values, { obustave: [{ iznos: true }, { naziv: true }] }, true)).toEqual({
      obustave: [
        { naziv: "KREDIT", vjerovnik: null, iznos: "101.00", ostatakSalda: null, brojRata: null },
      ],
    });
  });

  it("sends an emptied table as []", () => {
    const values = { ...toFormValues(fields, "en"), obustave: [] };

    expect(toPatch(values, { obustave: [{ naziv: true }] }, true)).toEqual({ obustave: [] });
  });

  it("sends no table while the tables pass is pending", () => {
    const values = toFormValues(fields, "en");

    expect(toPatch(values, { obustave: [{ iznos: true }], netoPlaca: true }, false)).toEqual({
      netoPlaca: "1500.00",
    });
  });

  it("types every table column", () => {
    expect(Object.keys(COLUMN_KINDS)).toEqual([...TABLE_FIELDS]);
  });
});
