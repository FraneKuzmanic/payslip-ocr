import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalPayslipFieldsSchema } from "@payslip/shared";
import { editedFields } from "../../../validation/edited.js";
import { mapAnalyzeResult, mapRetainedPass } from "./fields.js";
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

  it("maps a scalars pass retained as its two parts, each scalar from its owner (Task 17)", () => {
    const header = regionsPassBody({
      employerName: sourced("Tvrtka d.o.o.", "D(1,1,3,2,3,2,4,1,4)"),
      netoPlaca: sourced("9,00", "D(1,1,1,2,1,2,2,1,2)"),
    });
    const reconciliation = regionsPassBody({
      netoPlaca: sourced("1.500,00", "D(1,1,1,2,1,2,2,1,2)"),
    });

    const original = originalExtraction({
      scalars: { header, reconciliation },
      tables: tablesBody,
    })!;

    expect(original).toEqual(originalExtraction({ scalars: scalarsBody, tables: tablesBody }));
    expect(original.netoPlaca).toBe("1500.00");
    expect(original.employerName).toBe("Tvrtka d.o.o.");
  });

  it("re-maps the table rows in the order the payslip was stored in (Task 17 D13)", () => {
    // Returned bottom row first.
    const tables = regionsPassBody({
      obustave: rows(
        { naziv: sourced("DRUGA", "D(1,0,5,1,5,1,6,0,6)") },
        { naziv: sourced("PRVA", "D(1,0,2,1,2,1,3,0,3)") },
      ),
    });
    const names = (metadata?: unknown) =>
      originalExtraction({ tables }, metadata)?.obustave?.map((row) => row.naziv);

    expect(names({ tables: { rowOrder: "printed" } })).toEqual(["PRVA", "DRUGA"]);
    expect(names()).toEqual(["DRUGA", "PRVA"]);
  });

  it("gives the scalars alone while the tables body is missing", () => {
    const original = originalExtraction({ scalars: scalarsBody })!;
    expect(original.netoPlaca).toBe("1500.00");
    expect(original).not.toHaveProperty("obustave");
  });

  it.each([
    null,
    "garbage",
    { scalars: "nope" },
    { tables: { result: {} } },
    { scalars: { header: scalarsBody } },
  ])("gives null for %j", (raw) => {
    expect(originalExtraction(raw)).toBeNull();
  });
});

// Local-only: the recordings are git-ignored personal data, so CI skips this.
// One set recorded before Task 17 (a single scalars body) and one since (its two parts).
const bakeoff = fileURLToPath(new URL("../../../../../.bakeoff/", import.meta.url));
const SETS = ["two-pass-sequential", "task17-sequential"];

describe.skipIf(!existsSync(join(bakeoff, "two-pass-sequential")))(
  "originalExtraction over the recorded responses",
  () => {
    it.each(SETS)("never marks an untouched payslip edited in %s", (set) => {
      const recordings = join(bakeoff, set);
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
              ...mapRetainedPass(stored.scalars, "scalars")?.fields,
            }),
          ),
        );
        // Stored by today's provider: rows in printed order, and marked so (Task 17 D13).
        const metadata = { tables: { rowOrder: "printed" } };
        expect(editedFields(merged, originalExtraction(stored, metadata)), file).toEqual([]);

        // Stored before: rows as returned, no mark.
        const before = canonicalPayslipFieldsSchema.parse(
          JSON.parse(
            JSON.stringify({
              ...mapAnalyzeResult(stored.tables, "tables", "returned")?.fields,
              ...mapRetainedPass(stored.scalars, "scalars")?.fields,
            }),
          ),
        );
        expect(editedFields(before, originalExtraction(stored)), file).toEqual([]);
      }
    });
  },
);
