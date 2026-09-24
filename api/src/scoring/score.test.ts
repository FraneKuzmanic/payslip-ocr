import { describe, expect, it } from "vitest";
import type { CanonicalPayslipFields } from "@payslip/shared";
import {
  SCALAR_FIELDS,
  UnscoredExpectationError,
  percentiles,
  scoreSet,
  type ScoringInput,
} from "./score.js";

/** A complete expectation: every canonical key present, as a fixture carries them. */
function expectation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sample: "X01",
    sourceFile: "x.pdf",
    currency: "EUR",
    notes: [],
    ...Object.fromEntries(SCALAR_FIELDS.map((field) => [field, null])),
    employeeName: "Ana Horvat",
    brutoPlaca: "1000.00",
    period: "2025-05",
    payComponents: [],
    obustave: [],
    neoporeziviPrimici: [],
    ...overrides,
  };
}

function input(
  expected: Record<string, unknown>,
  actual: CanonicalPayslipFields,
  latencyMs: number | null = null,
): ScoringInput {
  return { sample: String(expected["sample"]), expected, actual, latencyMs };
}

/** What a faithful extraction of `expected` maps to. */
function faithful(expected: Record<string, unknown>): CanonicalPayslipFields {
  const {
    sample: _s,
    sourceFile: _f,
    currency: _c,
    notes: _n,
    unscorable: _u,
    ...fields
  } = expected;
  return fields as CanonicalPayslipFields;
}

function problemsOf(inputs: ScoringInput[]): string[] {
  try {
    scoreSet(inputs);
  } catch (error) {
    if (error instanceof UnscoredExpectationError) return error.problems;
    throw error;
  }
  return [];
}

describe("scoreSet", () => {
  it("scores a perfect sample 25/25 on scalars", () => {
    const expected = expectation();

    const report = scoreSet([input(expected, faithful(expected))]);

    expect(report.scalars).toEqual({ hit: 25, total: 25 });
    expect(report.critical).toEqual({ hit: 7, total: 7 });
  });

  it("fails loudly, naming the field, when an expectation key is removed", () => {
    const { netoPlaca: _removed, ...expected } = expectation();

    expect(problemsOf([input(expected, {})])).toEqual(["X01: expectation has no 'netoPlaca'"]);
  });

  it("fails loudly when a table expectation is removed", () => {
    const { obustave: _removed, ...expected } = expectation();

    expect(problemsOf([input(expected, {})])).toContain("X01: expectation has no 'obustave'");
  });

  it("fails on an unknown expectation key and an unknown unscorable field", () => {
    const expected = expectation({
      brutto: "1.00",
      unscorable: [{ field: "nonsense", reason: "r" }],
    });

    expect(problemsOf([input(expected, {})])).toEqual([
      "X01: unscorable names unknown field 'nonsense'",
      "X01: expectation carries unknown key 'brutto'",
    ]);
  });

  it("fails on an unknown table column and a table that is not a list", () => {
    const expected = expectation({
      payComponents: [
        { naziv: "REDOVAN RAD", sati: null, koeficijent: null, iznos: "1.00", izn: "1" },
      ],
      obustave: { naziv: "KREDIT" },
    });

    expect(problemsOf([input(expected, {})])).toEqual([
      "X01: expectation carries unknown key 'payComponents.0.izn'",
      "X01: expectation 'obustave' is neither a list nor null",
    ]);
  });

  it("collects the problems of every sample before throwing", () => {
    const { period: _a, ...first } = expectation({ sample: "A" });
    const { period: _b, ...second } = expectation({ sample: "B" });

    expect(problemsOf([input(first, {}), input(second, {})])).toHaveLength(2);
  });

  it("skips and lists a field declared unscorable", () => {
    const expected = expectation({ unscorable: [{ field: "paymentDate", reason: "off-screen" }] });
    const { paymentDate: _removed, ...rest } = expected;

    const report = scoreSet([input(rest, faithful(rest))]);

    expect(report.scalars.total).toBe(24);
    expect(report.skipped).toEqual([{ sample: "X01", field: "paymentDate", reason: "off-screen" }]);
  });

  it("compares decimals by value and keeps null distinct from zero", () => {
    const expected = expectation({ netoPlaca: "100.50", obustaveUkupno: null });

    const report = scoreSet([
      input(expected, { ...faithful(expected), netoPlaca: "100.5", obustaveUkupno: "0.00" }),
    ]);

    expect(report.perField.get("netoPlaca")).toEqual({ hit: 1, total: 1 });
    expect(report.perField.get("obustaveUkupno")).toEqual({ hit: 0, total: 1 });
  });

  it("is strict on diacritics in the headline and lenient in the bake-off line", () => {
    const expected = expectation({ employeeName: "Ana Janžek" });

    const report = scoreSet([
      input(expected, { ...faithful(expected), employeeName: "Ana Janzek" }),
    ]);

    expect(report.scalars).toEqual({ hit: 24, total: 25 });
    expect(report.scalarsLenient).toEqual({ hit: 25, total: 25 });
  });

  it("ignores case and spacing in text on both lines", () => {
    const expected = expectation({ employeeName: "Ana Horvat" });

    const report = scoreSet([
      input(expected, { ...faithful(expected), employeeName: "ANA  HORVAT" }),
    ]);

    expect(report.scalars.hit).toBe(25);
    expect(report.scalarsLenient.hit).toBe(25);
  });

  it("scores table cells positionally, with a missing row missing every cell", () => {
    const row = { naziv: "Prehrana", iznos: "100.00" };
    const expected = expectation({
      neoporeziviPrimici: [row, { naziv: "Prijevoz", iznos: "50.00" }],
    });

    const report = scoreSet([
      input(expected, { ...faithful(expected), neoporeziviPrimici: [row] }),
    ]);

    expect(report.tables.neoporeziviPrimici).toEqual({
      rowsExact: { hit: 0, total: 1 },
      cells: { hit: 2, total: 4 },
    });
    expect(report.perSample[0]?.rows.neoporeziviPrimici).toEqual({ actual: 1, expected: 2 });
  });

  it("counts extra actual rows only against the row count", () => {
    const row = { naziv: "Prehrana", iznos: "100.00" };
    const expected = expectation({ neoporeziviPrimici: [row] });

    const report = scoreSet([
      input(expected, { ...faithful(expected), neoporeziviPrimici: [row, row] }),
    ]);

    expect(report.tables.neoporeziviPrimici).toEqual({
      rowsExact: { hit: 0, total: 1 },
      cells: { hit: 2, total: 2 },
    });
  });

  it("reports the bake-off-comparable payComponents naziv + iznos cells", () => {
    const expected = expectation({
      payComponents: [{ naziv: "Redovan rad", sati: "160", koeficijent: null, iznos: "1000.00" }],
    });

    const report = scoreSet([input(expected, faithful(expected))]);

    expect(report.bakeoffComparable).toEqual({ hit: 2, total: 2 });
    expect(report.tables.payComponents.cells).toEqual({ hit: 4, total: 4 });
  });

  it("reports latency percentiles over the recordings that carry one", () => {
    const expected = expectation();

    const report = scoreSet([
      input(expected, faithful(expected), 1000),
      input(expected, faithful(expected), null),
      input(expected, faithful(expected), 3000),
    ]);

    expect(report.latency).toEqual({ p50: 1000, p90: 3000, max: 3000 });
  });
});

describe("percentiles", () => {
  it("uses nearest rank", () => {
    expect(percentiles([5, 1, 4, 2, 3, 10, 9, 8, 7, 6])).toEqual({ p50: 5, p90: 9, max: 10 });
  });

  it("is null without data", () => {
    expect(percentiles([null])).toBeNull();
  });
});
