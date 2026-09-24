/**
 * A payslip date is a local wall-clock date with no timezone, so it is carried as a plain
 * `yyyy-mm-dd` string and never as a `Date`.
 *
 * `Date.parse` is deliberately unused throughout this module. It returns `NaN` for
 * `"17.08.2026."`, and — far worse — reads `"08/17/2026"` as the day *before* in any
 * timezone behind UTC, which is a plausible-looking answer that is silently wrong.
 */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:mm`, or `HH:mm:ss` when the source showed seconds. */
export const ISO_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const WHITESPACE = /[\s\u00A0\u202F]/g;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DAY_FIRST_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;
// OCR sometimes reads the colon of a time as a dot or a comma.
const TIME = /^(\d{1,2})[:.,](\d{2})(?:[:.,](\d{2}))?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Normalizes an issue date into `yyyy-mm-dd`. Day-first is assumed for separator-delimited
 * dates, which is the Croatian and wider European convention (PRD §7.7).
 *
 * Returns `null` for anything unreadable or for a date that does not exist — a wrong date is
 * worse than a missing one, because the user cannot see that it needs correcting.
 */
export function parseIssueDate(raw: string | null | undefined): string | null {
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

/**
 * Normalizes an issue time into `HH:mm`, or `HH:mm:ss` when the source showed seconds.
 *
 * The precision of the source is preserved: padding `14:30` out to `14:30:00` would invent
 * a second that the document never stated (PRD §7.7).
 */
export function parseIssueTime(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const match = TIME.exec(raw.replace(WHITESPACE, ""));
  if (match === null) return null;

  const [, rawHour, rawMinute, rawSecond] = match;
  if (rawHour === undefined || rawMinute === undefined) return null;

  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (hour > 23 || minute > 59) return null;

  if (rawSecond === undefined) return `${pad2(hour)}:${pad2(minute)}`;

  const second = Number(rawSecond);
  if (second > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
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
