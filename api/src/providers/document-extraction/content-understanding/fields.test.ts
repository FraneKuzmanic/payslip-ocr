import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalPayslipFieldsSchema } from "@payslip/shared";
import { mapAnalyzeResult } from "./fields.js";

/** A minimal succeeded operation body, shaped like the recordings in `.bakeoff/cu/`. */
function operation(fields: Record<string, unknown>, markdown = "# OBRAČUN PLAĆE") {
  return {
    id: "op",
    status: "Succeeded",
    result: { contents: [{ kind: "document", markdown, fields }] },
  };
}

const str = (valueString?: string, confidence = 0.9) => ({
  type: "string",
  confidence,
  ...(valueString === undefined ? {} : { valueString }),
});

const table = (rows: Record<string, unknown>[]) => ({
  type: "array",
  valueArray: rows.map((valueObject) => ({ type: "object", valueObject })),
});

describe("mapAnalyzeResult", () => {
  it("normalises a printed amount and records its confidence", () => {
    const mapped = mapAnalyzeResult(operation({ netoPlaca: str("2.298,97", 0.82) }));

    expect(mapped?.fields.netoPlaca).toBe("2298.97");
    expect(mapped?.fieldMetadata["netoPlaca"]).toEqual({ confidence: 0.82, source: "model" });
    expect(mapped?.unreadableFields).toEqual([]);
  });

  it("maps a missing valueString to null, with no metadata and not unreadable", () => {
    const mapped = mapAnalyzeResult(operation({ brutoPlaca: str(undefined) }));

    expect(mapped?.fields.brutoPlaca).toBeNull();
    expect(mapped?.fieldMetadata).not.toHaveProperty("brutoPlaca");
    expect(mapped?.unreadableFields).toEqual([]);
  });

  it("records printed text the parser rejects as unreadable, never as a guess", () => {
    const mapped = mapAnalyzeResult(operation({ brutoPlaca: str("abc") }));

    expect(mapped?.fields.brutoPlaca).toBeNull();
    expect(mapped?.unreadableFields).toEqual(["brutoPlaca"]);
    expect(mapped?.fieldMetadata["brutoPlaca"]).toEqual({ confidence: 0.9, source: "model" });
  });

  it("treats a whitespace-only value as absent, not unreadable", () => {
    const mapped = mapAnalyzeResult(operation({ employerName: str("   ") }));

    expect(mapped?.fields.employerName).toBeNull();
    expect(mapped?.unreadableFields).toEqual([]);
  });

  it("normalises the printed period and payment date", () => {
    const mapped = mapAnalyzeResult(
      operation({ period: str("svibanj 2025."), paymentDate: str("09.06.2025") }),
    );

    expect(mapped?.fields.period).toBe("2025-05");
    expect(mapped?.fields.paymentDate).toBe("2025-06-09");
  });

  it("reads coefficients as quantities and keeps brojRata as text", () => {
    const mapped = mapAnalyzeResult(
      operation({
        payComponents: table([{ naziv: str("REDOVAN RAD"), koeficijent: str("0,135") }]),
        obustave: table([{ naziv: str("Kredit"), brojRata: str("10/120") }]),
      }),
    );

    expect(mapped?.fields.payComponents).toEqual([
      { naziv: "REDOVAN RAD", sati: null, koeficijent: "0.135", iznos: null },
    ]);
    expect(mapped?.fields.obustave?.[0]?.brojRata).toBe("10/120");
    expect(mapped?.fieldMetadata["payComponents.0.koeficijent"]).toEqual({
      confidence: 0.9,
      source: "model",
    });
  });

  it("maps an absent valueArray to an empty table", () => {
    const mapped = mapAnalyzeResult(operation({ obustave: { type: "array" } }));

    expect(mapped?.fields.obustave).toEqual([]);
    expect(mapped?.fields.payComponents).toEqual([]);
    expect(mapped?.fields.neoporeziviPrimici).toEqual([]);
  });

  it("lists an unreadable table cell by its dotted path", () => {
    const mapped = mapAnalyzeResult(
      operation({ obustave: table([{ naziv: str("Sindikat"), iznos: str("n/a") }]) }),
    );

    expect(mapped?.fields.obustave?.[0]?.iznos).toBeNull();
    expect(mapped?.unreadableFields).toEqual(["obustave.0.iznos"]);
  });

  it("ignores currency: the envelope is always EUR", () => {
    const mapped = mapAnalyzeResult(operation({ currency: str("EUR") }));

    expect(mapped?.fields).not.toHaveProperty("currency");
    expect(mapped?.fieldMetadata).not.toHaveProperty("currency");
  });

  it("returns every canonical key", () => {
    const mapped = mapAnalyzeResult(operation({}));

    expect(Object.keys(mapped?.fields ?? {}).toSorted()).toEqual(
      Object.keys(canonicalPayslipFieldsSchema.shape).toSorted(),
    );
  });

  it("reports whether the document carried any text", () => {
    expect(mapAnalyzeResult(operation({}, "  \n "))?.hasText).toBe(false);
    expect(mapAnalyzeResult(operation({}))?.hasText).toBe(true);
  });

  it.each([
    ["no result", { status: "Succeeded" }],
    ["no contents", { result: { contents: [] } }],
    ["a non-string value", operation({ netoPlaca: { valueString: 12 } })],
    ["not an object", "Succeeded"],
  ])("returns null for a body with %s", (_name, body) => {
    expect(mapAnalyzeResult(body)).toBeNull();
  });
});

// Local-only: the recordings are git-ignored personal data, so CI skips this.
const recordingsDir = fileURLToPath(new URL("../../../../../.bakeoff/cu/", import.meta.url));

describe.skipIf(!existsSync(recordingsDir))("mapAnalyzeResult over the recorded responses", () => {
  it("maps every recording to valid canonical fields", () => {
    const files = readdirSync(recordingsDir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const mapped = mapAnalyzeResult(JSON.parse(readFileSync(join(recordingsDir, file), "utf8")));
      expect(mapped, file).not.toBeNull();
      expect(mapped?.hasText, file).toBe(true);
    }
  });
});
