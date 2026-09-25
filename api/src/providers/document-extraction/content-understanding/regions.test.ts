import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapAnalyzeResult } from "./fields.js";
import { projectSourceRegions } from "./regions.js";
import { regionsPassBody, rows, sourced } from "./regions.fixture.js";

const QUAD = "D(1,2,1,4,1,4,2,2,2)";
const QUAD_CORNERS = [
  { x: 0.25, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.2 },
  { x: 0.25, y: 0.2 },
];

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

// Local-only: the recordings are git-ignored personal data, so CI skips this.
const bakeoff = fileURLToPath(new URL("../../../../../.bakeoff/", import.meta.url));
const SETS = [
  { name: "two-pass-sequential", twoPass: true },
  { name: "two-pass-concurrent", twoPass: true },
  { name: "cu", twoPass: false },
] as const;

describe.skipIf(!existsSync(join(bakeoff, "cu")))(
  "projectSourceRegions over the recorded responses",
  () => {
    it.each(SETS)("covers every sourced value in $name", ({ name, twoPass }) => {
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

        const scalars = mapAnalyzeResult(stored.scalars, "scalars");
        const tables = mapAnalyzeResult(stored.tables, "tables");
        // Every path the mapper read (a non-blank printed value) has an outline.
        const read = [
          ...Object.keys(scalars?.fieldMetadata ?? {}),
          ...Object.keys(tables?.fieldMetadata ?? {}),
        ];
        expect(
          read.filter((path) => !outlined.has(path)),
          file,
        ).toEqual([]);
        // The DoD form: every non-null scalar.
        const nonNull = Object.entries(scalars?.fields ?? {})
          .filter(([, value]) => typeof value === "string")
          .map(([path]) => path);
        expect(
          nonNull.filter((path) => !outlined.has(path)),
          file,
        ).toEqual([]);

        const pageNumbers = new Set(projected.pages.map((page) => page.page));
        for (const region of projected.regions) {
          expect(pageNumbers.has(region.page), file).toBe(true);
          for (const { x, y } of region.corners) {
            expect(x >= 0 && x <= 1 && y >= 0 && y <= 1, file).toBe(true);
          }
        }
        const body = stored.scalars as { result: { contents: [{ pages: unknown[] }] } };
        expect(projected.pages, file).toHaveLength(body.result.contents[0].pages.length);
      }
    });
  },
);
