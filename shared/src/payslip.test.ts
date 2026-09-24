import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CRITICAL_FIELDS, canonicalPayslipFieldsSchema, payslipSchema } from "./payslip.js";

const FIXTURE_DIRECTORY = new URL("../../.agents/fixtures/expected/", import.meta.url);

/** Keys a golden-set fixture carries about itself, which are not canonical fields. */
const FIXTURE_METADATA_KEYS = [
  "sample",
  "sourceFile",
  "layoutFamily",
  "layoutName",
  "sourceKind",
  "pageCount",
  "currency",
  "notes",
  "unscorable",
];

const CANONICAL_KEYS = Object.keys(canonicalPayslipFieldsSchema.shape);

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIRECTORY), "utf8")) as Record<
    string,
    unknown
  >;
}

const fixtureFiles = readdirSync(FIXTURE_DIRECTORY).filter((name) => name.endsWith(".json"));

function pickCanonical(fixture: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CANONICAL_KEYS.map((key) => [key, fixture[key]]));
}

const envelope = {
  id: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  status: "processing",
  pageCount: 1,
  currency: "EUR",
  warnings: [],
  createdAt: "2026-09-24T10:00:00Z",
  updatedAt: "2026-09-24T10:00:00Z",
};

const b01 = pickCanonical(readFixture("B01.json"));

describe("payslipSchema", () => {
  it("accepts every field null", () => {
    const allNull = Object.fromEntries(CANONICAL_KEYS.map((key) => [key, null]));
    expect(payslipSchema.safeParse({ ...envelope, ...allNull }).success).toBe(true);
  });

  it("accepts the envelope alone, as a payslip still processing", () => {
    expect(payslipSchema.safeParse(envelope).success).toBe(true);
  });

  it("accepts a fully populated payslip (B01)", () => {
    expect(payslipSchema.safeParse({ ...envelope, ...b01, status: "review" }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(payslipSchema.safeParse({ ...envelope, status: "pending" }).success).toBe(false);
  });

  it.each(["id", "sessionId", "userId"])("rejects a non-UUID %s", (key) => {
    expect(payslipSchema.safeParse({ ...envelope, [key]: "not-a-uuid" }).success).toBe(false);
  });

  it.each(["1.234,56", "100,50", "€100.50", "1e5"])(
    "rejects the un-normalised amount %j",
    (brutoPlaca) => {
      expect(payslipSchema.safeParse({ ...envelope, brutoPlaca }).success).toBe(false);
    },
  );

  it.each(["svibanj 2025.", "2025-13", "2025-6"])("rejects the period %j", (period) => {
    expect(payslipSchema.safeParse({ ...envelope, period }).success).toBe(false);
  });

  it.each(["09.06.2025", "2025-02-31"])("rejects the payment date %j", (paymentDate) => {
    expect(payslipSchema.safeParse({ ...envelope, paymentDate }).success).toBe(false);
  });

  it("rejects a currency other than EUR", () => {
    expect(payslipSchema.safeParse({ ...envelope, currency: "HRK" }).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const result = payslipSchema.safeParse({ ...envelope, tenantId: "t1" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects an unknown key inside a table row", () => {
    const payComponents = [{ naziv: "REDOVAN RAD", iznos: "100.00", confidence: 0.9 }];
    expect(payslipSchema.safeParse({ ...envelope, payComponents }).success).toBe(false);
  });

  it("accepts an instalment count printed as text", () => {
    const obustave = [{ naziv: "KREDIT", brojRata: "10/120" }];
    expect(payslipSchema.safeParse({ ...envelope, obustave }).success).toBe(true);
  });

  it("keeps an empty table distinct from a missing one", () => {
    const empty = payslipSchema.parse({ ...envelope, obustave: [] });
    const missing = payslipSchema.parse({ ...envelope, obustave: null });
    expect(empty.obustave).toEqual([]);
    expect(missing.obustave).toBeNull();
  });
});

describe("CRITICAL_FIELDS (PRD §6.5)", () => {
  it("names seven canonical fields", () => {
    expect(CRITICAL_FIELDS).toHaveLength(7);
    for (const field of CRITICAL_FIELDS) {
      expect(CANONICAL_KEYS).toContain(field);
    }
  });
});

describe("golden-set fixtures round-trip through the canonical schema", () => {
  it("finds all eleven fixtures, so an empty directory cannot pass vacuously", () => {
    expect(fixtureFiles).toHaveLength(11);
  });

  it.each(fixtureFiles)("%s", (name) => {
    const fixture = readFixture(name);

    // A key the schema lacks would otherwise be dropped silently by the pick below — the
    // failure mode the fixtures README warns about.
    const unknown = Object.keys(fixture).filter(
      (key) => !CANONICAL_KEYS.includes(key) && !FIXTURE_METADATA_KEYS.includes(key),
    );
    expect(unknown).toEqual([]);

    const missing = CANONICAL_KEYS.filter((key) => !(key in fixture));
    expect(missing).toEqual([]);

    const picked = pickCanonical(fixture);
    expect(canonicalPayslipFieldsSchema.parse(picked)).toEqual(picked);

    expect(fixture.currency).toBe("EUR");
    expect(Number.isInteger(fixture.pageCount) && (fixture.pageCount as number) >= 1).toBe(true);
  });
});

describe("provider independence", () => {
  it("mentions no provider vocabulary anywhere in shared/src", () => {
    // PRD §6.2: provider response objects must never become the application schema. Enforced
    // by a test rather than by inspection, because the canonical model is the one place a
    // provider field name would do lasting damage.
    const forbidden =
      /azure|prebuilt|documentintelligence|contentunderstanding|content understanding|analyzeresult|analyzer|boundingregion|polygon|valuestring|valuearray|valueobject/i;
    const directory = fileURLToPath(new URL(".", import.meta.url));

    const offenders = readdirSync(directory, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => forbidden.test(readFileSync(join(directory, name), "utf8")))
      // This test names the vocabulary it bans, so it necessarily contains it.
      .filter((name) => name !== "payslip.test.ts");

    expect(offenders).toEqual([]);
  });
});
