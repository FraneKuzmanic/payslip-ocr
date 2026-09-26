import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalPayslipFieldsSchema } from "@payslip/shared";
import { editedFields } from "../../../validation/edited.js";
import { mapAnalyzeResult } from "./fields.js";
import { originalExtraction } from "./original.js";
import { regionsPassBody, rows, sourced } from "./regions.fixture.js";

const scalarsBody = regionsPassBody({
  netoPlaca: sourced("1.500,00", "D(1,1,1,2,1,2,2,1,2)"),
  employerName: sourced("Tvrtka d.o.o.", "D(1,1,3,2,3,2,4,1,4)"),
});
const tablesBody = regionsPassBody({
  obustave: rows({
    naziv: sourced("KREDIT", "D(1,1,5,2,5,2,6,1,6)"),
    iznos: sourced("100,00", "D(1,3,5,4,5,4,6,3,6)"),
  }),
});

describe("originalExtraction", () => {
  it("maps each stored body through its own pass, as the extraction runner stored them", () => {
    expect(originalExtraction({ scalars: scalarsBody, tables: tablesBody })).toEqual({
      ...mapAnalyzeResult(scalarsBody, "scalars")!.fields,
      ...mapAnalyzeResult(tablesBody, "tables")!.fields,
    });
    const original = originalExtraction({ scalars: scalarsBody, tables: tablesBody })!;
    expect(original.netoPlaca).toBe("1500.00");
    expect(original.obustave).toEqual([
      { naziv: "KREDIT", vjerovnik: null, iznos: "100.00", ostatakSalda: null, brojRata: null },
    ]);
  });

  it("gives the scalars alone while the tables body is missing", () => {
    const original = originalExtraction({ scalars: scalarsBody })!;
    expect(original.netoPlaca).toBe("1500.00");
    expect(original).not.toHaveProperty("obustave");
  });

  it.each([null, "garbage", { scalars: "nope" }, { tables: { result: {} } }])(
    "gives null for %j",
    (raw) => {
      expect(originalExtraction(raw)).toBeNull();
    },
  );
});

// Local-only: the recordings are git-ignored personal data, so CI skips this.
const recordings = fileURLToPath(
  new URL("../../../../../.bakeoff/two-pass-sequential/", import.meta.url),
);

describe.skipIf(!existsSync(recordings))("originalExtraction over the recorded responses", () => {
  it("never marks an untouched payslip edited", () => {
    const files = readdirSync(recordings).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(11);

    for (const file of files) {
      const stored = JSON.parse(readFileSync(join(recordings, file), "utf8")) as {
        scalars: unknown;
        tables: unknown;
      };
      // What the row holds after both passes: `{} || scalars || tables` in the database, through
      // JSON, then parsed on read as `mapPayslipRow` parses it.
      const merged = canonicalPayslipFieldsSchema.parse(
        JSON.parse(
          JSON.stringify({
            ...mapAnalyzeResult(stored.tables, "tables")?.fields,
            ...mapAnalyzeResult(stored.scalars, "scalars")?.fields,
          }),
        ),
      );
      expect(editedFields(merged, originalExtraction(stored)), file).toEqual([]);
    }
  });
});
