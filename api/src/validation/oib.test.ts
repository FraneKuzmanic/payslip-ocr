import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isValidOib } from "./oib.js";

const FIXTURE_DIRECTORY = new URL("../../../.agents/fixtures/expected/", import.meta.url);

const fixtureFiles = readdirSync(FIXTURE_DIRECTORY).filter((name) => name.endsWith(".json"));

/** Every non-null OIB printed on a golden-set payslip, labelled for the test name. */
const fixtureOibs = fixtureFiles.flatMap((name) => {
  const fixture = JSON.parse(readFileSync(new URL(name, FIXTURE_DIRECTORY), "utf8")) as Record<
    string,
    unknown
  >;
  return (["employerOib", "employeeOib"] as const).flatMap((field) =>
    typeof fixture[field] === "string" ? [[`${name} ${field}`, fixture[field]] as const] : [],
  );
});

/** The last digit changed to the next one, which no valid OIB can survive. */
function withWrongCheckDigit(oib: string): string {
  return oib.slice(0, 10) + String((Number(oib[10]) + 1) % 10);
}

describe("isValidOib", () => {
  it("finds all eleven fixtures, so an empty directory cannot pass vacuously", () => {
    expect(fixtureFiles).toHaveLength(11);
    expect(fixtureOibs.length).toBeGreaterThanOrEqual(19);
  });

  it.each(fixtureOibs)("accepts the golden set's %s", (_label, oib) => {
    expect(isValidOib(oib)).toBe(true);
  });

  it.each(fixtureOibs)(
    "rejects the golden set's %s with its check digit changed",
    (_label, oib) => {
      expect(isValidOib(withWrongCheckDigit(oib))).toBe(false);
    },
  );

  it("writes a check of 10 as the digit 0", () => {
    // Ten leading digits 0000000001 leave a = 1, so the check is 11 − 1 = 10, written 0.
    expect(isValidOib("00000000010")).toBe(true);
    expect(isValidOib("00000000011")).toBe(false);
  });

  it.each([
    ["an HR prefix", "HR00000000010"],
    ["ten digits", "0000000001"],
    ["twelve digits", "000000000100"],
    ["a letter", "0000000001O"],
    ["a space", "00000 000010"],
    ["an empty string", ""],
  ])("rejects %s", (_label, oib) => {
    expect(isValidOib(oib)).toBe(false);
  });
});
