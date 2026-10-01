import { describe, expect, it } from "vitest";
import { inPrintedOrder, parseSegment, storedRowOrder, storedTotalRow } from "./row-order.js";

/** A cell printed on `page` with its top edge at `y`, 0.2 tall. */
const at = (page: number, y: number) => ({
  source: `D(${page},1,${y},2,${y},2,${y + 0.2},1,${y + 0.2})`,
});
const row = (label: string, cells: Record<string, { source?: string }>) => ({
  label,
  valueObject: cells,
});
const labels = (rows: { label: string }[]) => rows.map((entry) => entry.label);

describe("parseSegment", () => {
  it("reads a page and its eight numbers", () => {
    expect(parseSegment("D(2,1,2,3,4,5,6,7,8)")).toEqual({
      page: 2,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8],
    });
  });

  it.each(["D(1,1,2,3)", "X(1,1,2,3,4,5,6,7,8)", "D(1,NaN,2,3,4,5,6,7,8)", ""])(
    "gives null for %j",
    (segment) => {
      expect(parseSegment(segment)).toBeNull();
    },
  );
});

describe("inPrintedOrder (Task 17 D13)", () => {
  it("orders rows top to bottom, a page at a time", () => {
    const rows = [
      row("p2 low", { naziv: at(2, 5), iznos: at(2, 5) }),
      row("p1", { naziv: at(1, 9), iznos: at(1, 9) }),
      row("p2 high", { naziv: at(2, 1), iznos: at(2, 1) }),
    ];
    expect(labels(inPrintedOrder(rows))).toEqual(["p1", "p2 high", "p2 low"]);
  });

  it("is not moved by one cell whose source is on other text (A01's creditors)", () => {
    const rows = [
      // Printed third, but its creditor's source sits at the top of page 1.
      row("third", { naziv: at(2, 3), vjerovnik: at(1, 0.5), iznos: at(2, 3) }),
      row("first", { naziv: at(2, 1), vjerovnik: at(2, 1), iznos: at(2, 1) }),
      row("second", { naziv: at(2, 2), vjerovnik: at(2, 2), iznos: at(2, 2) }),
    ];
    expect(labels(inPrintedOrder(rows))).toEqual(["first", "second", "third"]);
  });

  // The limit of the middle: two cells have none, so the upper one places the row.
  it("is moved by a stray source above a row of only two sourced cells", () => {
    const rows = [
      row("first", { naziv: at(2, 1), iznos: at(2, 1) }),
      row("second, stray", { naziv: at(2, 2), iznos: at(1, 0.5) }),
    ];
    expect(labels(inPrintedOrder(rows))).toEqual(["second, stray", "first"]);
  });

  it("places a row by the first line of a value printed across lines", () => {
    const wrapped = { source: `${at(1, 2).source};${at(1, 2.3).source}` };
    const rows = [row("below", { naziv: at(1, 2.6) }), row("wrapped", { naziv: wrapped })];
    expect(labels(inPrintedOrder(rows))).toEqual(["wrapped", "below"]);
  });

  it("leaves a row without any source where it was returned", () => {
    const rows = [
      row("low", { naziv: at(1, 5) }),
      row("unplaced", { naziv: {} }),
      row("high", { naziv: at(1, 1) }),
    ];
    expect(labels(inPrintedOrder(rows))).toEqual(["high", "unplaced", "low"]);
  });

  it("keeps rows printed at the same height in the order returned", () => {
    const rows = [row("a", { naziv: at(1, 1) }), row("b", { naziv: at(1, 1) })];
    expect(labels(inPrintedOrder(rows))).toEqual(["a", "b"]);
  });

  it("returns rows already in printed order unchanged", () => {
    const rows = [row("a", { naziv: at(1, 1) }), row("b", { naziv: at(1, 2) })];
    expect(inPrintedOrder(rows)).toEqual(rows);
  });
});

describe("storedTotalRow (Task 17 D14)", () => {
  it("is the row the tables pass recorded as left out", () => {
    expect(storedTotalRow({ tables: { rowOrder: "printed", totalRow: 0 } })).toBe(0);
  });

  it.each([null, {}, { tables: {} }, { tables: { totalRow: "0" } }, { scalars: { totalRow: 0 } }])(
    "is null for %j: no row was left out",
    (metadata) => {
      expect(storedTotalRow(metadata)).toBeNull();
    },
  );
});

describe("storedRowOrder", () => {
  it("is printed when the tables pass says so", () => {
    expect(storedRowOrder({ scalars: {}, tables: { rowOrder: "printed" } })).toBe("printed");
  });

  it.each([null, undefined, {}, { tables: {} }, { scalars: { rowOrder: "printed" } }, "x"])(
    "is returned for %j: a payslip extracted before Task 17",
    (metadata) => {
      expect(storedRowOrder(metadata)).toBe("returned");
    },
  );
});
