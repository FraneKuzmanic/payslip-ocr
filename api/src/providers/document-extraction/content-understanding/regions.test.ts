import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Json } from "../../../database.types.js";
import { mapAnalyzeResult, mapRetainedPass, scalarPartBodies } from "./fields.js";
import { projectSourceRegions } from "./regions.js";
import { regionsPassBody, rows, sourced, word } from "./regions.fixture.js";

const QUAD = "D(1,2,1,4,1,4,2,2,2)";
const QUAD_CORNERS = [
  { x: 0.25, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.2 },
  { x: 0.25, y: 0.2 },
];

// The QUAD box is x 2–4, y 1–2 on an 8 × 10 page; a word spans x0–x1 on that line unless given.
const wordAt = (content: string, x0: number, x1: number, y0 = 1.1, y1 = 1.9) =>
  word(content, `D(1,${x0},${y0},${x1},${y0},${x1},${y1},${x0},${y1})`);

function withWords(fields: Parameters<typeof regionsPassBody>[0], ...words: Json[]) {
  return regionsPassBody(fields, [{ pageNumber: 1, width: 8, height: 10, words }]);
}

const outlinedPaths = (raw: unknown) =>
  projectSourceRegions(raw).regions.flatMap((region) => region.fields);

function scalarsOnly(
  fields: Parameters<typeof regionsPassBody>[0],
  pages?: Parameters<typeof regionsPassBody>[1],
) {
  return { scalars: regionsPassBody(fields, pages) };
}

describe("projectSourceRegions", () => {
  it("divides an inch page's quad by its own dimensions", () => {
    expect(projectSourceRegions(scalarsOnly({ netoPlaca: sourced("2.298,97", QUAD) }))).toEqual({
      pages: [{ page: 1, aspectRatio: 0.8 }],
      regions: [{ fields: ["netoPlaca"], page: 1, corners: QUAD_CORNERS, origin: "model" }],
    });
  });

  it("gives a pixel page the same fractions, whatever the unit", () => {
    const projected = projectSourceRegions(
      scalarsOnly({ netoPlaca: sourced("2.298,97", "D(1,250,200,500,200,500,400,250,400)") }, [
        { pageNumber: 1, width: 1000, height: 2000 },
      ]),
    );
    expect(projected.regions[0]?.corners).toEqual([
      { x: 0.25, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.2 },
      { x: 0.25, y: 0.2 },
    ]);
    expect(projected.pages).toEqual([{ page: 1, aspectRatio: 0.5 }]);
  });

  it("gives one region per printed line, all for the same path (D3)", () => {
    const projected = projectSourceRegions(
      scalarsOnly({ employeeAddress: sourced("ILICA 1\nZAGREB", `${QUAD};D(1,2,3,4,3,4,4,2,4)`) }),
    );
    expect(projected.regions).toHaveLength(2);
    expect(projected.regions.map((region) => region.fields)).toEqual([
      ["employeeAddress"],
      ["employeeAddress"],
    ]);
  });

  it("outlines nothing for a blank value, a missing source or a non-canonical field", () => {
    const projected = projectSourceRegions(
      scalarsOnly({
        netoPlaca: sourced("  ", QUAD),
        brutoPlaca: { type: "string", valueString: "3.000,00" },
        prirez: sourced("12,00", QUAD),
      }),
    );
    expect(projected.regions).toEqual([]);
  });

  it("outlines an unreadable value (D6)", () => {
    const projected = projectSourceRegions(scalarsOnly({ netoPlaca: sourced("12,3,4", QUAD) }));
    expect(projected.regions.map((region) => region.fields)).toEqual([["netoPlaca"]]);
  });

  it("keys table cells by the raw row index", () => {
    const projected = projectSourceRegions({
      tables: regionsPassBody({
        payComponents: rows({ iznos: sourced("100,00", QUAD) }),
        obustave: rows(
          { naziv: sourced("KREDIT", "D(1,0,0,1,0,1,1,0,1)") },
          { vjerovnik: sourced("BANKA", "D(1,0,2,1,2,1,3,0,3)") },
        ),
      }),
    });
    expect(projected.regions.map((region) => region.fields[0])).toEqual([
      "payComponents.0.iznos",
      "obustave.0.naziv",
      "obustave.1.vjerovnik",
    ]);
  });

  describe("table rows in printed order (Task 17 D13)", () => {
    // Returned bottom row first.
    const tables = regionsPassBody({
      obustave: rows(
        { naziv: sourced("DRUGA", "D(1,0,5,1,5,1,6,0,6)") },
        { naziv: sourced("PRVA", "D(1,0,2,1,2,1,3,0,3)") },
      ),
    });

    it("keys cells by the printed row index when the tables pass was stored that way", () => {
      const projected = projectSourceRegions({ tables }, { tables: { rowOrder: "printed" } });

      expect(projected.regions.map((region) => [region.fields[0], region.corners[0]?.y])).toEqual([
        ["obustave.0.naziv", 0.2],
        ["obustave.1.naziv", 0.5],
      ]);
      // The same rows the mapper stored under those indexes.
      expect(mapAnalyzeResult(tables, "tables")?.fields.obustave?.map((row) => row.naziv)).toEqual([
        "PRVA",
        "DRUGA",
      ]);
    });

    it("keeps the returned index for a payslip stored before", () => {
      for (const metadata of [undefined, null, { tables: {} }]) {
        const projected = projectSourceRegions({ tables }, metadata);
        expect(projected.regions.map((region) => [region.fields[0], region.corners[0]?.y])).toEqual(
          [
            ["obustave.0.naziv", 0.5],
            ["obustave.1.naziv", 0.2],
          ],
        );
      }
    });
  });

  it("skips a malformed segment and keeps its siblings", () => {
    const projected = projectSourceRegions(
      scalarsOnly({
        netoPlaca: sourced(
          "1,00",
          `D(1,1,2,3);X(1,2,1,4,1,4,2,2,2);D(1,NaN,1,4,1,4,2,2,2);${QUAD}`,
        ),
      }),
    );
    expect(projected.regions).toEqual([
      { fields: ["netoPlaca"], page: 1, corners: QUAD_CORNERS, origin: "model" },
    ]);
  });

  it("skips a segment on a page with no dimensions", () => {
    const projected = projectSourceRegions(
      scalarsOnly({ netoPlaca: sourced("1,00", "D(2,2,1,4,1,4,2,2,2)") }, [
        { pageNumber: 1, width: 8, height: 10 },
        { pageNumber: 2, width: 0, height: 10 },
      ]),
    );
    expect(projected.regions).toEqual([]);
    expect(projected.pages).toEqual([{ page: 1, aspectRatio: 0.8 }]);
  });

  it("clamps out-of-range corners into [0, 1]", () => {
    const projected = projectSourceRegions(
      scalarsOnly({ netoPlaca: sourced("1,00", "D(1,-1,-1,9,-1,9,11,-1,11)") }),
    );
    expect(projected.regions[0]?.corners).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  });

  it("merges two fields with an identical quad into one region", () => {
    const projected = projectSourceRegions(
      scalarsOnly({ netoPlaca: sourced("1,00", QUAD), iznosZaIsplatu: sourced("1,00", QUAD) }),
    );
    expect(projected.regions).toEqual([
      { fields: ["netoPlaca", "iznosZaIsplatu"], page: 1, corners: QUAD_CORNERS, origin: "model" },
    ]);
  });

  it("reads scalar paths only from the scalars body and table paths only from the tables body", () => {
    const projected = projectSourceRegions({
      scalars: regionsPassBody({
        netoPlaca: sourced("1,00", QUAD),
        payComponents: rows({ iznos: sourced("5,00", "D(1,0,0,1,0,1,1,0,1)") }),
      }),
      tables: regionsPassBody({
        brutoPlaca: sourced("9,00", "D(1,0,5,1,5,1,6,0,6)"),
        payComponents: rows({ iznos: sourced("7,00", "D(1,0,8,1,8,1,9,0,9)") }),
      }),
    });
    expect(projected.regions.map((region) => region.fields[0])).toEqual([
      "netoPlaca",
      "payComponents.0.iznos",
    ]);
    expect(projected.regions[1]?.corners[0]).toEqual({ x: 0, y: 0.8 });
  });

  it.each([null, {}, "x", { scalars: { nonsense: 1 } }])("projects nothing from %j", (raw) => {
    expect(projectSourceRegions(raw)).toEqual({ pages: [], regions: [] });
  });

  describe("a scalars pass retained as its two parts (Task 17 D9)", () => {
    it("reads each scalar from the part that owns it, and nothing from the other", () => {
      const projected = projectSourceRegions({
        scalars: {
          header: regionsPassBody({
            employerName: sourced("Tvrtka d.o.o.", QUAD),
            // The reconciliation part owns it.
            netoPlaca: sourced("9,00", "D(1,0,5,1,5,1,6,0,6)"),
          }),
          reconciliation: regionsPassBody({
            netoPlaca: sourced("1,00", "D(1,0,8,1,8,1,9,0,9)"),
            // The header part owns it.
            employerName: sourced("Druga tvrtka", "D(1,0,2,1,2,1,3,0,3)"),
          }),
        },
      });
      expect(projected.regions.map((region) => region.fields)).toEqual([
        ["employerName"],
        ["netoPlaca"],
      ]);
      expect(projected.regions[0]?.corners).toEqual(QUAD_CORNERS);
      expect(projected.regions[1]?.corners[0]).toEqual({ x: 0, y: 0.8 });
      expect(projected.pages).toEqual([{ page: 1, aspectRatio: 0.8 }]);
    });

    it("checks a value against the words of its own part", () => {
      const scalars = {
        header: withWords(
          { employerName: sourced("GRAD ZAGREB", QUAD) },
          wordAt("SPLIT", 2.2, 3.8),
        ),
        reconciliation: withWords(
          { netoPlaca: sourced("2.298,97", QUAD) },
          wordAt("2.298,97", 2.2, 3.8),
        ),
      };
      expect(outlinedPaths({ scalars })).toEqual(["netoPlaca"]);
    });

    it("keeps the readable part's regions when the other part is garbage", () => {
      const projected = projectSourceRegions({
        scalars: {
          header: { nonsense: 1 },
          reconciliation: regionsPassBody({ netoPlaca: sourced("1,00", QUAD) }),
        },
      });
      expect(projected.regions.map((region) => region.fields)).toEqual([["netoPlaca"]]);
      expect(projected.pages).toEqual([{ page: 1, aspectRatio: 0.8 }]);
    });

    it("projects nothing from one part alone", () => {
      expect(
        projectSourceRegions({
          scalars: { header: regionsPassBody({ employerName: sourced("Tvrtka", QUAD) }) },
        }),
      ).toEqual({ pages: [], regions: [] });
    });
  });

  it("takes pages from the tables body when there is no scalars body", () => {
    const projected = projectSourceRegions({
      tables: regionsPassBody({}, [
        { pageNumber: 2, width: 10, height: 10 },
        { pageNumber: 1, width: 8, height: 10 },
      ]),
    });
    expect(projected.pages).toEqual([
      { page: 1, aspectRatio: 0.8 },
      { page: 2, aspectRatio: 1 },
    ]);
  });
});

describe("projectSourceRegions: an outline must show its value (Task 16 D6)", () => {
  it("outlines a value whose words are under its quad", () => {
    const scalars = withWords(
      { netoPlaca: sourced("2.298,97", QUAD) },
      wordAt("2.298,97", 2.2, 3.8),
    );
    expect(outlinedPaths({ scalars })).toEqual(["netoPlaca"]);
  });

  it("withholds a creditor outlined on another word, even when its words are elsewhere (A04)", () => {
    const tables = withWords(
      { obustave: rows({ vjerovnik: sourced("SPH PU VUKOVAR", QUAD) }) },
      wordAt("VUKOVARA", 2.2, 3.8),
      wordAt("SPH", 5, 5.5, 5.1, 5.9),
      wordAt("PU", 5.6, 6, 5.1, 5.9),
      wordAt("VUKOVAR", 6.1, 7, 5.1, 5.9),
    );
    expect(outlinedPaths({ tables })).toEqual([]);
  });

  it("withholds a normalised date over unrelated words, and outlines it over a printed form (D01)", () => {
    const value = { paymentDate: sourced("2025-06-10", QUAD) };
    const wrong = withWords(
      value,
      wordAt("20", 2.1, 2.5),
      wordAt(",", 2.6, 2.7),
      wordAt("10000", 2.8, 3.9),
    );
    const right = withWords(value, wordAt("10.06.25", 2.2, 3.8));
    expect(outlinedPaths({ scalars: wrong })).toEqual([]);
    expect(outlinedPaths({ scalars: right })).toEqual(["paymentDate"]);
  });

  it("withholds a date over a lone fragment of it (C01)", () => {
    const scalars = withWords(
      { paymentDate: sourced("2025-07-01", QUAD) },
      wordAt("2025.", 2.2, 3.8),
    );
    expect(outlinedPaths({ scalars })).toEqual([]);
  });

  it.each([[["1.234,56"]], [["1", ".234,56"]]])("outlines an amount split as %j", (contents) => {
    const words = contents.map((content, index) => wordAt(content, 2.1 + index, 2.9 + index));
    const scalars = withWords({ brutoPlaca: sourced("1.234,56", QUAD) }, ...words);
    expect(outlinedPaths({ scalars })).toEqual(["brutoPlaca"]);
  });

  it("outlines a two-line value when both lines show it, and withholds it when one does not", () => {
    const value = { employeeAddress: sourced("ILICA 1\nZAGREB", `${QUAD};D(1,2,3,4,3,4,4,2,4)`) };
    const ilica = [wordAt("ILICA", 2.1, 3), wordAt("1", 3.1, 3.5)];
    const right = withWords(value, ...ilica, wordAt("ZAGREB", 2.1, 3.8, 3.1, 3.9));
    const wrong = withWords(value, ...ilica, wordAt("SPLIT", 2.1, 3.8, 3.1, 3.9));
    expect(outlinedPaths({ scalars: right })).toEqual(["employeeAddress", "employeeAddress"]);
    expect(outlinedPaths({ scalars: wrong })).toEqual([]);
  });

  it("outlines a value whose tokens sit under it in another order", () => {
    const scalars = withWords(
      { employerName: sourced("GRAD ZAGREB", QUAD) },
      wordAt("ZAGREB", 2.1, 2.9),
      wordAt("GRAD", 3.1, 3.9),
    );
    expect(outlinedPaths({ scalars })).toEqual(["employerName"]);
  });

  it("outlines an OIB printed with its HR prefix", () => {
    const scalars = withWords(
      { employeeOib: sourced("12345678901", QUAD) },
      wordAt("HR12345678901", 2.1, 3.9),
    );
    expect(outlinedPaths({ scalars })).toEqual(["employeeOib"]);
  });

  it("ignores a word whose centre is outside the quad", () => {
    const scalars = withWords({ netoPlaca: sourced("100,00", QUAD) }, wordAt("100,00", 3.5, 5));
    expect(outlinedPaths({ scalars })).toEqual([]);
  });

  it("outlines as before on a page without words", () => {
    expect(outlinedPaths(scalarsOnly({ paymentDate: sourced("2025-06-10", QUAD) }))).toEqual([
      "paymentDate",
    ]);
  });
});

// Local-only: the recordings are git-ignored personal data, so CI skips this.
const bakeoff = fileURLToPath(new URL("../../../../../.bakeoff/", import.meta.url));
const SETS = [
  { name: "two-pass-sequential", twoPass: true },
  { name: "two-pass-concurrent", twoPass: true },
  { name: "hosted-quads", twoPass: true },
  { name: "task16-sequential", twoPass: true },
  { name: "task17-sequential", twoPass: true },
  { name: "cu", twoPass: false },
] as const;

/**
 * The read paths each recording leaves without an outline, because the words under the service's
 * source do not show the value (Task 16 D6). Measured in planning by a prototype of the rule and
 * reproduced here exactly: each is on the wrong text or a piece of a composed period, except A01's
 * `obustave.4.naziv` in `cu`, a correct outline of only the first of its lines, and A04's invented
 * payout in `task16-sequential`. Every other read path is outlined.
 */
const EXPECTED_WITHHELD: Record<(typeof SETS)[number]["name"], Record<string, string[]>> = {
  "two-pass-sequential": {
    A01: ["obustave.0.vjerovnik", "obustave.1.vjerovnik", "obustave.2.vjerovnik"],
    B01: ["period"],
    C01: ["period", "paymentDate"],
  },
  "two-pass-concurrent": { B02: ["period"], D01: ["period", "paymentDate"] },
  "hosted-quads": { B01: ["period"], B02: ["period"], C01: ["period", "paymentDate"] },
  // The first V2 set (Task 16 D5): no period or payment date withheld. A04's payout is occluded on
  // the screenshot, and the value the service invented for it is not what its outline covers.
  "task16-sequential": { A04: ["iznosZaIsplatu"] },
  // The first V3 set (Task 17 D10): A01's obustave came back in `two-pass-sequential`'s row order,
  // with the same three creditors on the wrong text. A04's occluded payout was left null.
  "task17-sequential": {
    A01: ["obustave.0.vjerovnik", "obustave.1.vjerovnik", "obustave.2.vjerovnik"],
  },
  cu: {
    A01: ["obustave.4.naziv"],
    B01: ["period"],
    B02: ["period"],
    C01: ["period", "paymentDate"],
    D01: ["period", "paymentDate"],
  },
};

describe.skipIf(!existsSync(join(bakeoff, "cu")))(
  "projectSourceRegions over the recorded responses",
  () => {
    // Outlines and the mapper must agree on a row's index in whichever order the payslip was
    // stored (Task 17 D13): the same number of values is withheld, on the same cells.
    it.each(SETS)("withholds as many outlines in printed order in $name", ({ name, twoPass }) => {
      const dir = join(bakeoff, name);
      for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
        const recording = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
          scalars?: unknown;
          tables?: unknown;
        };
        const tables = twoPass ? recording.tables : recording;
        const projected = projectSourceRegions({ tables }, { tables: { rowOrder: "printed" } });
        const outlined = new Set(projected.regions.flatMap((region) => region.fields));
        const read = Object.keys(mapAnalyzeResult(tables, "tables")?.fieldMetadata ?? {});
        const expected = (EXPECTED_WITHHELD[name][file.replace(/\.json$/, "")] ?? []).filter(
          (path) => path.includes("."),
        );
        expect(
          read.filter((path) => !outlined.has(path)),
          file,
        ).toHaveLength(expected.length);
      }
    });

    it.each(SETS)("outlines every sourced value that agrees in $name", ({ name, twoPass }) => {
      const dir = join(bakeoff, name);
      const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
      expect(files).toHaveLength(11);

      for (const file of files) {
        const recording = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
          scalars?: unknown;
          tables?: unknown;
        };
        const stored = twoPass
          ? { scalars: recording.scalars, tables: recording.tables }
          : { scalars: recording, tables: recording };
        const projected = projectSourceRegions(stored);
        const outlined = new Set(projected.regions.flatMap((region) => region.fields));

        // A single-pass recording is one body holding both passes' fields.
        const scalars = twoPass
          ? mapRetainedPass(stored.scalars, "scalars")
          : mapAnalyzeResult(stored.scalars, "scalars");
        // No metadata is given above, so the regions are in the returned order: so is this.
        const tables = mapAnalyzeResult(stored.tables, "tables", "returned");
        expect(scalars, file).not.toBeNull();
        expect(tables, file).not.toBeNull();
        // Every path the mapper read (a non-blank printed value) is outlined, except those withheld.
        const read = [
          ...Object.keys(scalars?.fieldMetadata ?? {}),
          ...Object.keys(tables?.fieldMetadata ?? {}),
        ];
        expect(
          read.filter((path) => !outlined.has(path)),
          file,
        ).toEqual(EXPECTED_WITHHELD[name][file.replace(/\.json$/, "")] ?? []);

        const pageNumbers = new Set(projected.pages.map((page) => page.page));
        for (const region of projected.regions) {
          expect(pageNumbers.has(region.page), file).toBe(true);
          for (const { x, y } of region.corners) {
            expect(x >= 0 && x <= 1 && y >= 0 && y <= 1, file).toBe(true);
          }
        }
        // Either stored shape (Task 17 D9): the pages are those of the first scalars body.
        const body = scalarPartBodies(stored.scalars)?.[0]?.body as {
          result: { contents: [{ pages: unknown[] }] };
        };
        expect(projected.pages, file).toHaveLength(body.result.contents[0].pages.length);
      }
    });
  },
);
