import { readFileSync, readdirSync } from "node:fs";
import {
  WARNING_CODES,
  addAmounts,
  canonicalPayslipFieldsSchema,
  type CanonicalPayslipFields,
  type PayslipWarning,
} from "@payslip/shared";
import { describe, expect, it } from "vitest";
import { computeWarnings, type WarningInput } from "./warnings.js";

const FIXTURE_DIRECTORY = new URL("../../../.agents/fixtures/expected/", import.meta.url);
const CANONICAL_KEYS = Object.keys(canonicalPayslipFieldsSchema.shape);

const fixtureFiles = readdirSync(FIXTURE_DIRECTORY).filter((name) => name.endsWith(".json"));

/** A golden-set fixture's canonical fields, without the keys it carries about itself. */
function fixture(sample: string): CanonicalPayslipFields {
  const raw = JSON.parse(
    readFileSync(new URL(`${sample}.json`, FIXTURE_DIRECTORY), "utf8"),
  ) as Record<string, unknown>;
  return canonicalPayslipFieldsSchema.parse(
    Object.fromEntries(CANONICAL_KEYS.map((key) => [key, raw[key]])),
  );
}

function warningsFor(
  fields: CanonicalPayslipFields,
  overrides: Partial<Omit<WarningInput, "fields">> = {},
): PayslipWarning[] {
  return computeWarnings({ fields, unreadableFields: [], tablesStatus: "ready", ...overrides });
}

const missing = (field: string): PayslipWarning => ({ code: "missing_critical_field", field });

/** Task 06 D10: the ground truth's expected warnings, exactly. */
const EXPECTED: Record<string, PayslipWarning[]> = {
  A01: [],
  A02: [],
  A03: [],
  A04: [missing("iznosZaIsplatu")],
  B01: [],
  B02: [],
  C01: [],
  D01: [],
  E01: [missing("employerName")],
  F01: [missing("employerName")],
  G01: [
    missing("employerName"),
    missing("employeeName"),
    missing("employeeOib"),
    missing("period"),
  ],
};

describe("computeWarnings over the golden set", () => {
  it("finds all eleven fixtures, so an empty directory cannot pass vacuously", () => {
    expect(fixtureFiles.map((name) => name.replace(/\.json$/, "")).toSorted()).toEqual(
      Object.keys(EXPECTED).toSorted(),
    );
  });

  it.each(Object.entries(EXPECTED))(
    "%s raises exactly its expected warnings",
    (sample, expected) => {
      expect(warningsFor(fixture(sample))).toEqual(expected);
    },
  );
});

describe("one-cent injections", () => {
  const a02 = fixture("A02");

  it("starts from a payslip with every identity operand present", () => {
    const operands = [
      a02.brutoPlaca,
      a02.doprinosiIzPlace,
      a02.dohodak,
      a02.osobniOdbitak,
      a02.poreznaOsnovica,
      a02.porezNaDohodak,
      a02.netoPlaca,
      a02.neoporeziviPrimiciUkupno,
      a02.obustaveUkupno,
      a02.iznosZaIsplatu,
      a02.payComponents?.[0]?.iznos,
    ];
    expect(operands.every((value) => value != null)).toBe(true);
    expect(warningsFor(a02)).toEqual([]);
  });

  // Each operand belongs to one identity only; dohodak, brutoPlaca and netoPlaca each feed two.
  it.each([
    ["doprinosiIzPlace", "dohodak_mismatch", "dohodak"],
    ["poreznaOsnovica", "porezna_osnovica_mismatch", "poreznaOsnovica"],
    ["porezNaDohodak", "neto_mismatch", "netoPlaca"],
    ["obustaveUkupno", "isplata_mismatch", "iznosZaIsplatu"],
  ] as const)("a cent on %s raises only %s", (operand, code, field) => {
    const fields = { ...a02, [operand]: addAmounts(a02[operand] as string, "0.01") };
    expect(warningsFor(fields)).toEqual([{ code, field }]);
  });

  it("a cent on one pay component raises only pay_components_sum_mismatch", () => {
    const [first, ...rest] = a02.payComponents ?? [];
    const fields = {
      ...a02,
      payComponents: [{ ...first!, iznos: addAmounts(first!.iznos!, "0.01") }, ...rest],
    };
    expect(warningsFor(fields)).toEqual([
      { code: "pay_components_sum_mismatch", field: "payComponents" },
    ]);
  });
});

describe("the porezna osnovica floor", () => {
  const b01 = fixture("B01");

  it("accepts B01's 0.00 where osobni odbitak equals dohodak", () => {
    expect(b01.poreznaOsnovica).toBe("0.00");
    expect(warningsFor(b01)).toEqual([]);
  });

  it("accepts 0.00 when the allowance exceeds dohodak", () => {
    expect(warningsFor({ ...b01, osobniOdbitak: "900.00" })).toEqual([]);
  });

  it("raises a mismatch for 0.01 against a floor of zero", () => {
    expect(warningsFor({ ...b01, poreznaOsnovica: "0.01" })).toEqual([
      { code: "porezna_osnovica_mismatch", field: "poreznaOsnovica" },
    ]);
  });
});

describe("identities with missing operands", () => {
  it("skips every identity that uses a null dohodak", () => {
    expect(warningsFor({ ...fixture("A02"), dohodak: null })).toEqual([]);
  });

  it("takes F01's absent obustave total as zero, and reconciles", () => {
    const f01 = fixture("F01");
    expect(f01.obustaveUkupno).toBeNull();
    expect(warningsFor(f01)).toEqual([missing("employerName")]);
  });

  it("raises isplata_mismatch when a printed total is dropped", () => {
    expect(warningsFor({ ...fixture("F01"), neoporeziviPrimiciUkupno: null })).toEqual([
      missing("employerName"),
      { code: "isplata_mismatch", field: "iznosZaIsplatu" },
    ]);
  });
});

describe("pay_components_sum_mismatch", () => {
  const a02 = fixture("A02");
  const mismatched = {
    ...a02,
    payComponents: [
      ...(a02.payComponents ?? []),
      { naziv: "X", sati: null, koeficijent: null, iznos: "1.00" },
    ],
  };

  it("raises nothing for G01's empty table", () => {
    expect(fixture("G01").payComponents).toEqual([]);
    expect(warningsFor(fixture("G01")).map((w) => w.code)).not.toContain(
      "pay_components_sum_mismatch",
    );
  });

  it.each(["pending", "failed"] as const)(
    "is not evaluated while the tables are %s",
    (tablesStatus) => {
      expect(warningsFor(mismatched, { tablesStatus })).toEqual([]);
    },
  );

  it("raises once the tables are ready", () => {
    expect(warningsFor(mismatched)).toEqual([
      { code: "pay_components_sum_mismatch", field: "payComponents" },
    ]);
  });

  it("leaves rows without an amount out of the sum", () => {
    const fields = {
      ...a02,
      payComponents: [
        ...(a02.payComponents ?? []),
        { naziv: "X", sati: "8", koeficijent: null, iznos: null },
      ],
    };
    expect(warningsFor(fields)).toEqual([]);
  });

  it("raises nothing when no row has an amount", () => {
    const fields = {
      ...a02,
      payComponents: [{ naziv: "X", sati: "8", koeficijent: null, iznos: null }],
    };
    expect(warningsFor(fields)).toEqual([]);
  });

  it("sums amounts, never hours", () => {
    // B02's leaf hours total 266 against a printed 176, and that is not an error.
    expect(warningsFor(fixture("B02"))).toEqual([]);
  });
});

describe("unreadable fields", () => {
  const a02 = fixture("A02");

  it("raises unparseable_date, not missing_critical_field, for an unreadable period", () => {
    expect(warningsFor({ ...a02, period: null }, { unreadableFields: ["period"] })).toEqual([
      { code: "unparseable_date", field: "period" },
    ]);
  });

  it("raises unparseable_date for an unreadable payment date", () => {
    expect(
      warningsFor({ ...a02, paymentDate: null }, { unreadableFields: ["paymentDate"] }),
    ).toEqual([{ code: "unparseable_date", field: "paymentDate" }]);
  });

  it("clears once the value has been filled in", () => {
    expect(warningsFor(a02, { unreadableFields: ["brutoPlaca"] })).toEqual([]);
  });

  it("raises unparseable_amount for an unreadable hours cell", () => {
    const [first, ...rest] = a02.payComponents ?? [];
    const fields = {
      ...a02,
      payComponents: [first!, { ...rest[0]!, sati: null }, ...rest.slice(1)],
    };
    expect(warningsFor(fields, { unreadableFields: ["payComponents.1.sati"] })).toEqual([
      { code: "unparseable_amount", field: "payComponents.1.sati" },
    ]);
  });

  it("treats a path to a row that no longer exists as unread", () => {
    expect(warningsFor(a02, { unreadableFields: ["obustave.40.iznos"] })).toEqual([
      { code: "unparseable_amount", field: "obustave.40.iznos" },
    ]);
  });
});

describe("OIB checksums", () => {
  it("raises oib_checksum_failed for a changed digit", () => {
    const a02 = fixture("A02");
    const oib = a02.employeeOib!;
    const changed = oib.slice(0, 3) + String((Number(oib[3]) + 1) % 10) + oib.slice(4);
    expect(warningsFor({ ...a02, employeeOib: changed })).toEqual([
      { code: "oib_checksum_failed", field: "employeeOib" },
    ]);
  });
});

describe("order", () => {
  it("returns warnings in WARNING_CODES order", () => {
    const a02 = fixture("A02");
    const warnings = warningsFor(
      {
        ...a02,
        employerName: null,
        period: null,
        brutoPlaca: null,
        employerOib: "HR1",
        porezNaDohodak: "0.00",
      },
      { unreadableFields: ["period", "brutoPlaca"] },
    );
    expect(warnings).toEqual([
      missing("employerName"),
      { code: "unparseable_amount", field: "brutoPlaca" },
      { code: "unparseable_date", field: "period" },
      { code: "oib_checksum_failed", field: "employerOib" },
      { code: "neto_mismatch", field: "netoPlaca" },
    ]);
    const codeOrder = warnings.map((w) => WARNING_CODES.indexOf(w.code));
    expect(codeOrder).toEqual(codeOrder.toSorted((a, b) => a - b));
  });
});
