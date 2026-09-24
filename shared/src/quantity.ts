import { parseAmount } from "./money.js";

const THREE_DECIMALS = /^(-?\d{1,3})[.,](\d{3})$/;

/**
 * Parses a line-item quantity into the same canonical decimal string as money.
 *
 * `parseAmount` reads `3,000` as 3000, because a thousands group is far more likely than a
 * three-decimal price. A quantity is the opposite case: POS systems print pieces and weights to
 * three decimals (`3,000`, `1.250`), while a four-digit count is rare — so here the same shape is
 * read as a decimal, and every other input follows the money rules.
 */
export function parseQuantity(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const match = THREE_DECIMALS.exec(raw.trim());
  return match ? `${match[1]}.${match[2]}` : parseAmount(raw);
}
