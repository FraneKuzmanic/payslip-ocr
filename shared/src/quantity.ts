import { parseAmount } from "./money.js";

const THREE_DECIMALS = /^(-?\d{1,3})[.,](\d{3})$/;

/**
 * Parses hours and coefficients — `sati`, `koeficijent` and `ukupnoSati` — into the same
 * canonical decimal string as money.
 *
 * Coefficients print to three decimals (F01 `1,000`, A03 `0,135`, and `0.065` in the golden
 * set). `parseAmount` rejects that shape as an ambiguous thousands group, which is right for
 * money, where cents are always printed, and wrong here. So a single separator followed by
 * exactly three digits is read as a decimal, and every other input follows the money rules.
 */
export function parseQuantity(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const match = THREE_DECIMALS.exec(raw.trim());
  return match ? `${match[1]}.${match[2]}` : parseAmount(raw);
}
