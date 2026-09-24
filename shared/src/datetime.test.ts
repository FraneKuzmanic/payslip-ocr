import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ISO_DATE_PATTERN, PERIOD_PATTERN, parseDate, parsePeriod } from "./datetime.js";

describe("parseDate", () => {
  it.each([
    // Croatian forms, including the trailing full stop and spaced-out variants.
    ["17.08.2026.", "2026-08-17"],
    ["17. 8. 2026.", "2026-08-17"],
    ["17.8.2026", "2026-08-17"],
    ["1.1.2026", "2026-01-01"],

    // Already ISO, and other separators.
    ["2026-08-17", "2026-08-17"],
    ["17/08/2026", "2026-08-17"],
    ["17-08-2026", "2026-08-17"],

    // Two-digit years pivot at 70.
    ["17.8.26", "2026-08-17"],
    ["17.8.85", "1985-08-17"],

    // Leap years validated by hand, not by Date.
    ["29.02.2024", "2024-02-29"],
    ["29.02.2026", null],
    ["31.02.2026", null],
    ["31.04.2026", null],
    ["17.13.2026", null],
    ["00.08.2026", null],

    // Unreadable stays missing (PRD §7.7).
    ["", null],
    [null, null],
    [undefined, null],
    ["nope", null],
    ["17.8.202", null],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });

  it("reads a day-first date as day-first, not month-first", () => {
    // The trap Date.parse falls into: "08/17/2026" is read as a US date and lands a day
    // early once a timezone offset is applied.
    expect(parseDate("08/09/2026")).toBe("2026-09-08");
  });
});

describe("parseDate on the golden set", () => {
  it.each([
    ["09.06.2025", "2025-06-09"], // A01
    ["09.06.2025.", "2025-06-09"], // A04
    ["10.07.2025", "2025-07-10"], // B01
    ["02.06.2025", "2025-06-02"], // B02
    ["01.07.2025.", "2025-07-01"], // C01
    ["10.06.25", "2025-06-10"], // D01
    ["8.7.2025.", "2025-07-08"], // E01
    ["6.06.2025", "2025-06-06"], // F01
    ["2025-07-10", "2025-07-10"], // already normalised by the provider
  ])("parses %j as %j", (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });
});

describe("parsePeriod", () => {
  // Strings as the provider returned them for the golden set, label text included. E01's
  // printed period is not isolated anywhere in its recorded output; the provider returned
  // "2025-06", which the ISO case covers.
  it.each([
    ["svibanj 2025.", "2025-05"], // A01, A02, A04
    ["lipanj 2025.", "2025-06"], // A03
    ["OBRAČUNSKA ISPRAVA ZA ISPLATU PLAĆE-NAKNADE ZA RAZDOBLJE: svibanj 2025.", "2025-05"], // A01
    ["GODINA 2025, MJESEC 6 DANI U MJESECU OD 9 DO 30", "2025-06"], // B01
    ["GODINA 2025, MJESEC 5 DANI U MJESECU OD 1 DO 31", "2025-05"], // B02
    ["GODINA 2025. MJESEC 6. DANI U MJESECU OD 01. DO 30.", "2025-06"], // C01
    ["GODINA 2025, MJESEC SVIBANJ, DANI U MJESECU OD 01.05.25 DO 31.05.25", "2025-05"], // D01
    ["2025-06", "2025-06"], // B–E, normalised by the provider
    ["1.05.2025 do 31.05.2025", "2025-05"], // F01
    ["01.06.2025-30.06.2025", "2025-06"], // G01 naknade range
  ])("parses the printed %j as %j", (raw, expected) => {
    expect(parsePeriod(raw)).toBe(expected);
  });

  it.each([
    ["siječanj", 1],
    ["veljača", 2],
    ["ožujak", 3],
    ["travanj", 4],
    ["svibanj", 5],
    ["lipanj", 6],
    ["srpanj", 7],
    ["kolovoz", 8],
    ["rujan", 9],
    ["listopad", 10],
    ["studeni", 11],
    ["prosinac", 12],
  ])("reads the nominative %j as month %i", (name, month) => {
    expect(parsePeriod(`${name} 2025`)).toBe(`2025-${String(month).padStart(2, "0")}`);
  });

  it.each([
    ["siječnja", 1],
    ["veljače", 2],
    ["ožujka", 3],
    ["travnja", 4],
    ["svibnja", 5],
    ["lipnja", 6],
    ["srpnja", 7],
    ["kolovoza", 8],
    ["rujna", 9],
    ["listopada", 10],
    ["studenoga", 11],
    ["studenog", 11],
    ["prosinca", 12],
  ])("reads the genitive %j as month %i", (name, month) => {
    expect(parsePeriod(`${name} 2025.`)).toBe(`2025-${String(month).padStart(2, "0")}`);
  });

  it.each([
    ["SVIBANJ 2025", "2025-05"],
    ["05/2025", "2025-05"],
  ])("parses %j as %j", (raw, expected) => {
    expect(parsePeriod(raw)).toBe(expected);
  });

  it.each([
    // A span across two months is not one period; rejected rather than taking the first date.
    ["01.05.2025 do 30.06.2025"],
    // A lone date could be the payment date or the period's end. E01 prints this near its period.
    ["30.6.2025."],
    ["svibanj"],
    ["2025-13"],
    ["GODINA 2025, MJESEC 13"],
    ["13/2025"],
    [""],
    [null],
    [undefined],
  ])("rejects %j", (raw) => {
    expect(parsePeriod(raw)).toBeNull();
  });
});

describe("output satisfies the schema layer", () => {
  // This is the seam where the two layers must agree: datetime.ts produces the strings,
  // and the canonical schema validates them with z.iso.date() and PERIOD_PATTERN.
  it("produces dates z.iso.date() accepts", () => {
    for (const raw of ["17.08.2026.", "1.1.2026", "29.02.2024", "17.8.26"]) {
      const parsed = parseDate(raw);
      expect(parsed).not.toBeNull();
      expect(parsed).toMatch(ISO_DATE_PATTERN);
      expect(z.iso.date().safeParse(parsed).success).toBe(true);
    }
  });

  it("produces periods PERIOD_PATTERN accepts", () => {
    for (const raw of ["svibanj 2025.", "GODINA 2025, MJESEC 6", "1.05.2025 do 31.05.2025"]) {
      expect(parsePeriod(raw)).toMatch(PERIOD_PATTERN);
    }
  });
});
