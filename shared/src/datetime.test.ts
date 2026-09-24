import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ISO_DATE_PATTERN, ISO_TIME_PATTERN, parseIssueDate, parseIssueTime } from "./datetime.js";

describe("parseIssueDate", () => {
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
    expect(parseIssueDate(raw)).toBe(expected);
  });

  it("reads a day-first date as day-first, not month-first", () => {
    // The trap Date.parse falls into: "08/17/2026" is read as a US date and lands a day
    // early once a timezone offset is applied.
    expect(parseIssueDate("08/09/2026")).toBe("2026-09-08");
  });
});

describe("parseIssueTime", () => {
  it.each([
    ["14:30", "14:30"],
    ["9:05", "09:05"],
    ["14:30:05", "14:30:05"],
    ["14.30", "14:30"],
    ["14,30", "14:30"],
    [" 14:30 ", "14:30"],
    ["24:00", null],
    ["14:60", null],
    ["14:30:60", null],
    ["", null],
    [null, null],
    [undefined, null],
    ["nope", null],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseIssueTime(raw)).toBe(expected);
  });

  it("does not invent seconds the document never showed", () => {
    expect(parseIssueTime("14:30")).not.toBe("14:30:00");
  });
});

describe("output satisfies the schema layer", () => {
  // This is the seam where the two layers must agree: datetime.ts produces the strings,
  // and the canonical schema validates them with z.iso.date()/z.iso.time().
  it("produces dates z.iso.date() accepts", () => {
    for (const raw of ["17.08.2026.", "1.1.2026", "29.02.2024", "17.8.26"]) {
      const parsed = parseIssueDate(raw);
      expect(parsed).not.toBeNull();
      expect(parsed).toMatch(ISO_DATE_PATTERN);
      expect(z.iso.date().safeParse(parsed).success).toBe(true);
    }
  });

  it("produces times z.iso.time() accepts", () => {
    for (const raw of ["14:30", "9:05", "14:30:05"]) {
      const parsed = parseIssueTime(raw);
      expect(parsed).not.toBeNull();
      expect(parsed).toMatch(ISO_TIME_PATTERN);
      expect(z.iso.time().safeParse(parsed).success).toBe(true);
    }
  });
});
