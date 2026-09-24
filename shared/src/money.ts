import Big from "big.js";

/**
 * Throws if a JS `number` is ever passed to `Big`, which turns "money is never a JS float"
 * (PRD §6.4, ROADMAP §5 rule 9) from a convention someone has to remember into a runtime
 * guarantee.
 */
Big.strict = true;

/**
 * Canonical money is a plain decimal string: no grouping separators, no currency symbol,
 * no exponent, `.` as the decimal point, and trailing zeros preserved exactly as parsed —
 * `100.50` must still be `100.50` after a round trip (PRD §6.4).
 */
export const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

// "kn" is the Croatian kuna abbreviation used on pre-2023 documents alongside the ISO code HRK.
const CURRENCY_TOKENS = /[€$£]|\b(?:EUR|HRK|USD|GBP|kn)\b/gi;
// \s already covers U+00A0 and U+202F, but both turn up in OCR text and in Intl output
// often enough to be worth naming explicitly rather than leaving to a reader's memory.
const WHITESPACE = /[\s\u00A0\u202F]/g;
const DIGITS_AND_SEPARATORS = /^[\d.,]+$/;
const DIGITS_ONLY = /^\d+$/;

export function isAmount(value: unknown): value is string {
  return typeof value === "string" && AMOUNT_PATTERN.test(value);
}

/**
 * Parses an amount as it appears on a payslip — Croatian (`1.234,56`) or English
 * (`1,234.56`) grouping, optional currency, OCR whitespace — into canonical form.
 *
 * Returns `null` for anything it cannot read, and never throws: a value it cannot parse is
 * a missing value, and missing stays missing rather than being invented (PRD §7.7).
 */
export function parseAmount(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  // Currency is stripped before whitespace is collapsed. The other order turns
  // "1234.56 EUR" into "1234.56EUR", where \bEUR\b no longer matches because `6` and `E`
  // are both word characters.
  const compact = raw.replace(CURRENCY_TOKENS, "").replace(WHITESPACE, "");
  if (compact === "") return null;

  const { negative, body } = stripSign(compact);
  if (!DIGITS_AND_SEPARATORS.test(body)) return null;

  const digits = normalizeSeparators(body);
  if (digits === null) return null;

  const normalized = negative ? `-${digits}` : digits;
  try {
    // Validation only. The returned string is the one built above, because
    // Big#toString() would silently drop the trailing zeros of "100.50".
    void new Big(normalized);
  } catch {
    return null;
  }
  return normalized;
}

/**
 * Adds two canonical amounts at the wider of their two scales, so `100.50 + 0.00` is
 * `100.50` rather than `100.5`.
 *
 * Both arguments must already be canonical — pass raw OCR text and `Big` will throw.
 * Callers parse first.
 */
export function addAmounts(a: string, b: string): string {
  return new Big(a).plus(b).toFixed(Math.max(scaleOf(a), scaleOf(b)));
}

/**
 * Compares two canonical amounts numerically, so `100.50` and `100.5` are equal despite
 * differing scale. Both arguments must already be canonical.
 */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const result = new Big(a).cmp(b);
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
}

export function amountsEqual(a: string, b: string): boolean {
  return new Big(a).eq(b);
}

/**
 * `Intl.NumberFormat#format` has accepted a string since ES2023 (Intl.NumberFormat V3), and
 * Node 24 honours it — verified: `format("12345678901234567890.99")` round-trips exactly,
 * while the same value as a `number` is corrupted to `12345678901234567000`. TypeScript's
 * bundled lib still types the parameter as `number` only, including under `ESNext.Intl`, so
 * the capability is declared here. Keeping it to one narrow interface confines the assertion
 * to a single place instead of every call site.
 */
interface StringNumberFormat {
  format(value: string): string;
}

/**
 * Formats a canonical amount for display. `Intl.NumberFormat` is fed the **string**, which
 * preserves arbitrary precision — passing a number would corrupt large values.
 *
 * Returns `null` for a missing amount so the caller decides what an empty field looks like.
 */
export function formatAmount(
  amount: string | null,
  options: { locale: string; currency?: string | null },
): string | null {
  if (amount === null) return null;
  const { locale, currency } = options;
  const formatter = new Intl.NumberFormat(
    locale,
    currency ? { style: "currency", currency } : {},
  ) as unknown as StringNumberFormat;
  return formatter.format(amount);
}

function scaleOf(amount: string): number {
  const index = amount.indexOf(".");
  return index === -1 ? 0 : amount.length - index - 1;
}

function stripSign(input: string): { negative: boolean; body: string } {
  if (input.startsWith("(") && input.endsWith(")")) {
    return { negative: true, body: input.slice(1, -1) };
  }
  if (input.startsWith("-")) return { negative: true, body: input.slice(1) };
  if (input.endsWith("-")) return { negative: true, body: input.slice(0, -1) };
  return { negative: false, body: input };
}

function normalizeSeparators(body: string): string | null {
  const dots = countOccurrences(body, ".");
  const commas = countOccurrences(body, ",");

  if (dots === 0 && commas === 0) {
    return DIGITS_ONLY.test(body) ? body : null;
  }

  // Both present: the last one is the decimal point, the other is grouping.
  if (dots > 0 && commas > 0) {
    const decimal = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    return splitAtDecimal(body, decimal);
  }

  const separator = dots > 0 ? "." : ",";
  if ((dots > 0 ? dots : commas) > 1) {
    return stripGrouping(body, separator);
  }

  const index = body.indexOf(separator);
  const before = body.slice(0, index);
  const after = body.slice(index + 1);

  // "1.234" and "1,234" are genuinely ambiguous — 1234, or 1.234? They are rejected rather
  // than guessed. Payslip money always prints its cents, so this shape is more likely an OCR
  // fault than a real value, and a `null` surfaces as a visible `unparseable_amount` warning
  // where a guess would be invisible. Hours and coefficients, which do print three decimals,
  // go through `parseQuantity` instead.
  if (after.length === 3 && before.length >= 1 && before.length <= 3) {
    return null;
  }

  return splitAtDecimal(body, separator);
}

function splitAtDecimal(body: string, decimalSeparator: string): string | null {
  const index = body.lastIndexOf(decimalSeparator);
  const fraction = body.slice(index + 1);
  if (!DIGITS_ONLY.test(fraction)) return null;

  const grouping = decimalSeparator === "." ? "," : ".";
  const integer = stripGrouping(body.slice(0, index), grouping);
  return integer === null ? null : `${integer}.${fraction}`;
}

/** Validates and removes thousands separators, rejecting groups that are not 3 digits. */
function stripGrouping(integer: string, separator: string): string | null {
  if (!integer.includes(separator)) {
    return DIGITS_ONLY.test(integer) ? integer : null;
  }

  const groups = integer.split(separator);
  const first = groups[0];
  if (first === undefined || first.length < 1 || first.length > 3 || !DIGITS_ONLY.test(first)) {
    return null;
  }
  for (let index = 1; index < groups.length; index += 1) {
    const group = groups[index];
    if (group === undefined || group.length !== 3 || !DIGITS_ONLY.test(group)) return null;
  }
  return groups.join("");
}

function countOccurrences(value: string, character: string): number {
  return value.split(character).length - 1;
}
