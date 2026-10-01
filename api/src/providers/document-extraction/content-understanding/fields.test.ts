import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalPayslipFieldsSchema } from "@payslip/shared";
import {
  SCALAR_FIELDS,
  findTotalRow,
  mapAnalyzeResult,
  mapRetainedPass,
  scalarPartBodies,
} from "./fields.js";

/** A minimal succeeded operation body, shaped like the recordings in `.bakeoff/cu/`. */
function operation(fields: Record<string, unknown>, markdown = "# OBRAČUN PLAĆE") {
  return {
    id: "op",
    status: "Succeeded",
    result: { contents: [{ kind: "document", markdown, fields }] },
  };
}

/** The same body with OCR words, one array per page. */
function operationWithWords(fields: Record<string, unknown>, pages: string[][]) {
  return {
    id: "op",
    status: "Succeeded",
    result: {
      contents: [
        {
          kind: "document",
          markdown: "# OBRAČUN PLAĆE",
          fields,
          pages: pages.map((words, index) => ({
            pageNumber: index + 1,
            words: words.map((content) => ({ content, confidence: 0.99 })),
          })),
        },
      ],
    },
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

  it("maps only the scalar keys on the scalars pass, and leaves the tables absent", () => {
    const mapped = mapAnalyzeResult(
      operation({ netoPlaca: str("2.298,97"), obustave: table([{ naziv: str("Sindikat") }]) }),
      "scalars",
    );

    expect(mapped?.fields.netoPlaca).toBe("2298.97");
    for (const key of ["payComponents", "obustave", "neoporeziviPrimici"]) {
      expect(mapped?.fields).not.toHaveProperty(key);
    }
    expect(Object.keys(mapped?.fieldMetadata ?? {})).toEqual(["netoPlaca"]);
  });

  it("maps only the table keys on the tables pass, with [] for an absent table", () => {
    const mapped = mapAnalyzeResult(
      operation({ netoPlaca: str("2.298,97"), obustave: table([{ naziv: str("Sindikat") }]) }),
      "tables",
    );

    expect(mapped?.fields).toEqual({
      payComponents: [],
      obustave: [
        { naziv: "Sindikat", vjerovnik: null, iznos: null, ostatakSalda: null, brojRata: null },
      ],
      neoporeziviPrimici: [],
    });
    expect(Object.keys(mapped?.fieldMetadata ?? {})).toEqual(["obustave.0.naziv"]);
  });

  describe("table rows in printed order (Task 17 D13)", () => {
    const cell = (valueString: string, y: number) => ({
      ...str(valueString),
      source: `D(1,1,${y},2,${y},2,${y + 0.2},1,${y + 0.2})`,
    });
    // Returned bottom row first.
    const body = operation({
      obustave: table([
        { naziv: cell("DRUGA", 5), iznos: cell("n/a", 5) },
        { naziv: cell("PRVA", 2), iznos: cell("10,00", 2) },
      ]),
    });

    it("maps rows in the order they are printed, with every path following", () => {
      const mapped = mapAnalyzeResult(body, "tables");

      expect(mapped?.fields.obustave?.map((row) => row.naziv)).toEqual(["PRVA", "DRUGA"]);
      expect(mapped?.unreadableFields).toEqual(["obustave.1.iznos"]);
      expect(Object.keys(mapped?.fieldMetadata ?? {})).toEqual([
        "obustave.0.naziv",
        "obustave.0.iznos",
        "obustave.1.naziv",
        "obustave.1.iznos",
      ]);
    });

    it("keeps the returned order when asked, for a payslip stored before", () => {
      const mapped = mapAnalyzeResult(body, "tables", "returned");

      expect(mapped?.fields.obustave?.map((row) => row.naziv)).toEqual(["DRUGA", "PRVA"]);
      expect(mapped?.unreadableFields).toEqual(["obustave.0.iznos"]);
      expect(mapRetainedPass(body, "tables", "returned")).toEqual(mapped);
    });
  });

  describe("the total row left out of the pay components (Task 17 D14)", () => {
    const cell = (valueString: string, y: number) => ({
      ...str(valueString),
      source: `D(1,1,${y},2,${y},2,${y + 0.2},1,${y + 0.2})`,
    });
    // As F01 came back: the gross total first, then the components that sum to it.
    const body = operation({
      payComponents: table([
        { naziv: cell("PLAĆA (BRUTO SVOTA)", 1), iznos: cell("2.009,94", 1) },
        { naziv: cell("Redovan rad", 2), iznos: cell("1.074,28", 2) },
        { naziv: cell("Stimulacija", 3), iznos: cell("935,66", 3) },
      ]),
    });

    it("finds the row that repeats bruto plaća when the other rows sum to it", () => {
      expect(findTotalRow(body, "2009.94")).toBe(0);
    });

    it.each([
      ["no row equals bruto plaća", "3000.00"],
      ["bruto plaća was not read", null],
    ])("finds none when %s", (_case, brutoPlaca) => {
      expect(findTotalRow(body, brutoPlaca)).toBeNull();
    });

    it("finds none when a row equals bruto plaća and the others do not sum to it", () => {
      const only = operation({ payComponents: table([{ iznos: str("2.009,94") }]) });
      const short = operation({
        payComponents: table([{ iznos: str("2.009,94") }, { iznos: str("100,00") }]),
      });

      expect(findTotalRow(only, "2009.94")).toBeNull();
      expect(findTotalRow(short, "2009.94")).toBeNull();
    });

    it("finds none in a body that does not map", () => {
      expect(findTotalRow("garbage", "2009.94")).toBeNull();
    });

    it("maps the table without that row, with every path following", () => {
      const mapped = mapAnalyzeResult(body, "tables", "printed", 0);

      expect(mapped?.fields.payComponents?.map((row) => row.naziv)).toEqual([
        "Redovan rad",
        "Stimulacija",
      ]);
      expect(Object.keys(mapped?.fieldMetadata ?? {})).toEqual([
        "payComponents.0.naziv",
        "payComponents.0.iznos",
        "payComponents.1.naziv",
        "payComponents.1.iznos",
      ]);
      expect(mapRetainedPass(body, "tables", "printed", 0)).toEqual(mapped);
    });

    it("keeps every row when none was left out", () => {
      expect(mapAnalyzeResult(body, "tables")?.fields.payComponents).toHaveLength(3);
    });
  });

  describe("grounding", () => {
    it("lists an invented value and not a printed one", () => {
      const mapped = mapAnalyzeResult(
        operationWithWords({ netoPlaca: str("1.466,36"), iznosZaIsplatu: str("2.033,32") }, [
          ["NETO", "1.466,36", "ISPLATA", "1.625,27"],
        ]),
      );

      expect(mapped?.ungroundableFields).toEqual(["iznosZaIsplatu"]);
      expect(mapped?.fields.iznosZaIsplatu).toBe("2033.32");
    });

    it("never lists the period", () => {
      const mapped = mapAnalyzeResult(
        operationWithWords({ period: str("lipanj 2025.") }, [["GODINA", "2025", "MJESEC", "6"]]),
      );

      expect(mapped?.fields.period).toBe("2025-06");
      expect(mapped?.ungroundableFields).toEqual([]);
    });

    it("lists a table cell by its canonical path", () => {
      const mapped = mapAnalyzeResult(
        operationWithWords({ obustave: table([{ naziv: str("Sindikat"), iznos: str("10,00") }]) }, [
          ["OBUSTAVE", "10,00"],
        ]),
      );

      expect(mapped?.ungroundableFields).toEqual(["obustave.0.naziv"]);
    });

    it("grounds an unreadable value against its printed text", () => {
      const mapped = mapAnalyzeResult(
        operationWithWords({ netoPlaca: str("1.219.08") }, [["NETO", "1.219.08"]]),
      );

      expect(mapped?.unreadableFields).toEqual(["netoPlaca"]);
      expect(mapped?.ungroundableFields).toEqual([]);
    });

    it("grounds nothing in a body without pages", () => {
      // Real bodies always carry pages; this pins what happens if one does not.
      const mapped = mapAnalyzeResult(operation({ netoPlaca: str("1.466,36") }));

      expect(mapped?.ungroundableFields).toEqual(["netoPlaca"]);
    });
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

describe("scalarPartBodies (Task 17 D9)", () => {
  it("gives a single body every scalar", () => {
    const body = operation({});
    expect(scalarPartBodies(body)).toEqual([{ body, fields: SCALAR_FIELDS }]);
  });

  it("gives one entry per part, each owning its role's fields", () => {
    const header = operation({});
    const reconciliation = operation({});
    const parts = scalarPartBodies({ header, reconciliation });

    expect(parts?.map((part) => part.body)).toEqual([header, reconciliation]);
    expect(parts?.[0]?.fields).toContain("period");
    expect(parts?.[1]?.fields).toContain("ukupnoSati");
    expect(parts?.flatMap((part) => part.fields).toSorted()).toEqual(SCALAR_FIELDS.toSorted());
  });

  it.each([null, "garbage", {}, { header: operation({}) }])("gives null for %j", (retained) => {
    expect(scalarPartBodies(retained)).toBeNull();
  });
});

describe("mapRetainedPass (Task 17 D5)", () => {
  const header = operationWithWords(
    { employerName: str("Tvrtka d.o.o."), period: str("svibanj 2025."), employeeOib: str("x y") },
    [["Tvrtka", "d.o.o.", "svibanj", "2025."]],
  );
  const reconciliation = operationWithWords(
    {
      netoPlaca: str("2.298,97", 0.7),
      brutoPlaca: str("abc"),
      // Not this part's field: the header owns it.
      employerName: str("Druga tvrtka"),
    },
    [["NETO", "2.298,97"]],
  );

  it("maps a single scalars body exactly as the mapper does", () => {
    const body = operationWithWords({ netoPlaca: str("2.298,97"), employerName: str("Tvrtka") }, [
      ["NETO", "2.298,97"],
    ]);
    expect(JSON.stringify(mapRetainedPass(body, "scalars"))).toBe(
      JSON.stringify(mapAnalyzeResult(body, "scalars")),
    );
  });

  it("maps the tables body as the mapper does", () => {
    const body = operation({ obustave: table([{ naziv: str("Sindikat") }]) });
    expect(mapRetainedPass(body, "tables")).toEqual(mapAnalyzeResult(body, "tables"));
  });

  it("takes each scalar from the part that owns it", () => {
    const mapped = mapRetainedPass({ header, reconciliation }, "scalars");

    expect(mapped?.fields.employerName).toBe("Tvrtka d.o.o.");
    expect(mapped?.fields.period).toBe("2025-05");
    expect(mapped?.fields.netoPlaca).toBe("2298.97");
    expect(mapped?.fieldMetadata["employerName"]).toEqual({ confidence: 0.9, source: "model" });
    expect(mapped?.fieldMetadata["netoPlaca"]).toEqual({ confidence: 0.7, source: "model" });
  });

  it("has every scalar key once, in schema order, and no table key", () => {
    const mapped = mapRetainedPass({ header, reconciliation }, "scalars");
    expect(Object.keys(mapped?.fields ?? {})).toEqual(SCALAR_FIELDS);
  });

  it("merges unreadable and ungroundable paths, each from its owning part", () => {
    const mapped = mapRetainedPass({ header, reconciliation }, "scalars");

    // `employerName` is ungroundable in the reconciliation body, which does not own it.
    expect(mapped?.unreadableFields).toEqual(["brutoPlaca"]);
    expect(mapped?.ungroundableFields).toEqual(["employeeOib", "brutoPlaca"]);
  });

  it("has text when either part has it", () => {
    const blank = operation({}, "  ");
    expect(mapRetainedPass({ header: blank, reconciliation }, "scalars")?.hasText).toBe(true);
    expect(mapRetainedPass({ header: blank, reconciliation: blank }, "scalars")?.hasText).toBe(
      false,
    );
  });

  it.each([
    ["a missing part", { header }],
    ["a garbage part", { header, reconciliation: { result: {} } }],
    ["garbage", "nope"],
  ])("gives null for %s", (_name, retained) => {
    expect(mapRetainedPass(retained, "scalars")).toBeNull();
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

  // The invariant that makes single- and two-pass recordings comparable in the harness.
  it("maps each recording, pass by pass, to exactly the single-pass mapping", () => {
    const files = readdirSync(recordingsDir).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      const body: unknown = JSON.parse(readFileSync(join(recordingsDir, file), "utf8"));
      const whole = mapAnalyzeResult(body);
      const scalars = mapAnalyzeResult(body, "scalars");
      const tables = mapAnalyzeResult(body, "tables");

      expect(JSON.stringify({ ...scalars?.fields, ...tables?.fields }), file).toBe(
        JSON.stringify(whole?.fields),
      );
      expect({ ...scalars?.fieldMetadata, ...tables?.fieldMetadata }, file).toEqual(
        whole?.fieldMetadata,
      );
      expect([...(scalars?.unreadableFields ?? []), ...(tables?.unreadableFields ?? [])]).toEqual(
        whole?.unreadableFields,
      );
      expect([
        ...(scalars?.ungroundableFields ?? []),
        ...(tables?.ungroundableFields ?? []),
      ]).toEqual(whole?.ungroundableFields);
    }
  });

  // Task 17 D14, measured over this set, where F01 came back with its total row first.
  it("finds a total row among the pay components of F01 alone", () => {
    const files = readdirSync(recordingsDir).filter((name) => name.endsWith(".json"));
    const found = files.flatMap((file) => {
      const body: unknown = JSON.parse(readFileSync(join(recordingsDir, file), "utf8"));
      const brutoPlaca = mapAnalyzeResult(body, "scalars")?.fields.brutoPlaca ?? null;
      const totalRow = findTotalRow(body, brutoPlaca);
      return totalRow === null ? [] : [[file, totalRow]];
    });

    expect(found).toEqual([["F01.json", 0]]);
  });

  // Task 06 D8, measured over this set: correct values ground, so the signal stays rare.
  it("grounds every scalar, and leaves at most one table cell ungrounded", () => {
    const files = readdirSync(recordingsDir).filter((name) => name.endsWith(".json"));
    const ungrounded = files.flatMap(
      (file) =>
        mapAnalyzeResult(JSON.parse(readFileSync(join(recordingsDir, file), "utf8")))
          ?.ungroundableFields ?? [],
    );

    // A canonical scalar path has no dot; a table cell's does.
    expect(ungrounded.filter((path) => !path.includes("."))).toEqual([]);
    expect(ungrounded.length).toBeLessThanOrEqual(1);
  });
});
