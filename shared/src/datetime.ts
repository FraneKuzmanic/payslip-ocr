/**
 * A payslip date is a local wall-clock date with no timezone, so it is carried as a plain
 * `yyyy-mm-dd` string and never as a `Date`.
 *
 * `Date.parse` is deliberately unused throughout this module. It returns `NaN` for
 * `"17.08.2026."`, and — far worse — reads `"08/17/2026"` as the day *before* in any
 * timezone behind UTC, which is a plausible-looking answer that is silently wrong.
 */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A payslip period: `yyyy-mm`, month 01–12. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const WHITESPACE = /[\s\u00A0\u202F]/g;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DAY_FIRST_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Normalizes a payslip date, such as the payment date, into `yyyy-mm-dd`. Day-first is assumed
 * for separator-delimited dates, which is the Croatian and wider European convention (PRD §7.7).
 *
 * Returns `null` for anything unreadable or for a date that does not exist — a wrong date is
 * worse than a missing one, because the user cannot see that it needs correcting.
 */
export function parseDate(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  // Croatian dates are written with a trailing full stop: "17.08.2026."
  const compact = raw.replace(WHITESPACE, "").replace(/\.$/, "");
  if (compact === "") return null;

  const iso = ISO_DATE.exec(compact);
  const dayFirst = iso === null ? DAY_FIRST_DATE.exec(compact) : null;

  const parts =
    iso !== null
      ? { year: iso[1], month: iso[2], day: iso[3] }
      : dayFirst !== null
        ? { year: dayFirst[3], month: dayFirst[2], day: dayFirst[1] }
        : null;

  if (parts?.year === undefined || parts.month === undefined || parts.day === undefined) {
    return null;
  }

  const year = expandYear(parts.year);
  if (year === null) return null;

  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!isRealDate(year, month, day)) return null;

  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

// Index = month − 1. A payslip prints the month either nominative ("svibanj 2025.") or
// genitive ("razdoblje svibnja 2025."); `studeni` has two genitives.
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["siječanj", "siječnja"],
  ["veljača", "veljače"],
  ["ožujak", "ožujka"],
  ["travanj", "travnja"],
  ["svibanj", "svibnja"],
  ["lipanj", "lipnja"],
  ["srpanj", "srpnja"],
  ["kolovoz", "kolovoza"],
  ["rujan", "rujna"],
  ["listopad", "listopada"],
  ["studeni", "studenoga", "studenog"],
  ["prosinac", "prosinca"],
];

const MONTH_BY_NAME = new Map(
  MONTH_NAMES.flatMap((names, index) => names.map((name) => [name, index + 1] as const)),
);

// Longest first, so "studenoga" wins over "studenog" and "studeni".
const MONTH = [...MONTH_BY_NAME.keys()].toSorted((a, b) => b.length - a.length).join("|");

const GODINA_MJESEC = new RegExp(`godina\\s*(\\d{4})\\.?,?\\s*mjesec\\s*(\\d{1,2}|${MONTH})`);
const NAMED_MONTH = new RegExp(`(${MONTH})\\.?\\s*(\\d{4})`);
const SPAN_DATE = String.raw`\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}\.?|\d{1,2}/\d{1,2}/\d{2,4}`;
const DATE_SPAN = new RegExp(`(?:od\\s*)?(${SPAN_DATE})\\s*(?:do|-|–)\\s*(${SPAN_DATE})`);
const MONTH_SLASH_YEAR = /^(\d{1,2})[./](\d{4})\.?$/;

/**
 * Normalizes a printed payslip period into `yyyy-mm`.
 *
 * The obračun form prescribes content, not layout (*Pravilnik* NN 68/2023), so the golden set's
 * seven layouts print the period five ways: `svibanj 2025.`, `GODINA 2025, MJESEC 6`,
 * `GODINA 2025, MJESEC SVIBANJ`, a date span `1.05.2025 do 31.05.2025`, or already `2025-06`.
 * The provider returns the printed text with its surrounding label, so the rules below search
 * rather than match whole strings.
 *
 * Ported from the bake-off scorer's `asPeriod`, but it rejects where that guessed: a span whose
 * two dates fall in different months, and a lone date — which could as well be the payment date
 * or the period's end — both return `null`.
 */
export function parsePeriod(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw
    .replace(/[\s  ]+/g, " ")
    .trim()
    .toLowerCase();
  if (text === "") return null;

  if (PERIOD_PATTERN.test(text)) return text;

  const godinaMjesec = GODINA_MJESEC.exec(text);
  if (godinaMjesec !== null) return toPeriod(godinaMjesec[1], godinaMjesec[2]);

  const named = NAMED_MONTH.exec(text);
  if (named !== null) return toPeriod(named[2], named[1]);

  const span = DATE_SPAN.exec(text);
  if (span !== null) {
    const from = parseDate(span[1]);
    const to = parseDate(span[2]);
    if (from === null || to === null) return null;
    return from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;
  }

  const monthSlashYear = MONTH_SLASH_YEAR.exec(text);
  if (monthSlashYear !== null) return toPeriod(monthSlashYear[2], monthSlashYear[1]);

  return null;
}

/** `month` is a number or a Croatian month name; anything outside 1–12 is not a period. */
function toPeriod(year: string | undefined, month: string | undefined): string | null {
  if (year === undefined || month === undefined) return null;
  const value = MONTH_BY_NAME.get(month) ?? Number(month);
  if (!Number.isInteger(value) || value < 1 || value > 12) return null;
  return `${year}-${pad2(value)}`;
}

/**
 * Two-digit years pivot at 70: `26` is 2026, `85` is 1985. Payslips are contemporary
 * documents, so the pivot only has to keep a plausible past from becoming the future.
 */
function expandYear(raw: string): number | null {
  if (raw.length === 4) return Number(raw);
  if (raw.length !== 2) return null;
  const value = Number(raw);
  return value < 70 ? 2000 + value : 1900 + value;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const days = DAYS_IN_MONTH[month - 1];
  if (days === undefined) return false;
  const limit = month === 2 && isLeapYear(year) ? 29 : days;
  return day >= 1 && day <= limit;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
