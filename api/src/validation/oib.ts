const OIB_PATTERN = /^\d{11}$/;

/**
 * Whether `oib` is a Croatian OIB whose check digit is right: exactly eleven ASCII digits, the
 * last one the ISO 7064 MOD 11,10 check over the first ten.
 *
 * Anything else fails, including an `HR` prefix or spaces. OIB fields accept any text on
 * purpose (a malformed OIB is exactly what `oib_checksum_failed` exists to surface), so this
 * never assumes the input is well formed. Ported from `scripts/check-golden-set.py`.
 */
export function isValidOib(oib: string): boolean {
  if (!OIB_PATTERN.test(oib)) return false;

  let a = 10;
  for (const digit of oib.slice(0, 10)) {
    a = (a + Number(digit)) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  // 11 − a is 1…10, and a check of 10 is written as 0.
  const check = (11 - a) % 10;
  return check === Number(oib[10]);
}
