/**
 * Grounding: whether a value's printed text can be found among the page's OCR words. A value
 * that cannot be found is a likely invention, which the bake-off measured at 100% precision
 * (ROADMAP locked decision 16). Only "was it found" is answered here; regions come from the
 * service's own `source` (Task 08).
 *
 * Ported from `scripts/bakeoff/ground.ts` (`key`, `surfaceForms` and the contiguous-run match
 * of `groundValue`). The service usually returns the printed string (locked decision 13), but
 * the field schema asks for `paymentDate` as `YYYY-MM-DD` and for OIBs without their `HR`
 * prefix, so a value is grounded by its printed string or by any form its canonical value
 * could be printed as. The bake-off's 200-character run cap is dropped: prefix pruning already
 * ends every run that cannot match, and the cap only made long values ungroundable.
 */

/**
 * Paths never grounded. The service composes `period` from non-adjacent cells on some layouts
 * (`GODINA 2025, MJESEC 6`), so 14 of 49 correct periods failed to ground and no wrong one was
 * caught (Task 06 D8); the bake-off excluded it for the same measured reason.
 */
export const UNGROUNDABLE_BY_DESIGN: readonly string[] = ["period"];

/**
 * The longest run of words one value may span. Long `obustave` names run to 13+ words
 * ("SINDIKALNA ČLANARINA - RATA KAO POSTOTAK NA NETO PLAĆU, …"); the bake-off's 12 flagged 6–7
 * correct ones per A01 run, 40 none (Task 06 D8).
 */
export const MAX_RUN = 40;

/**
 * Comparison key: whitespace-, `.,;:`-, diacritic- and case-insensitive, with `đ` as `d`, so
 * `PLACU` meets `PLAĆU` and an address that wraps a line loses nothing.
 */
export function groundingKey(text: string): string {
  return text
    .replace(/\s/g, "")
    .replace(/[.,;:]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/**
 * Croatian forms a canonical date or OIB may be printed as: `2025-06-09` as `09.06.2025`,
 * `9.6.25` and the like; an OIB with its `HR` prefix. These are the two kinds the field schema
 * asks to be normalised. Amounts need none: they come back as printed, and `groundingKey`
 * already ignores their separators. Periods have no forms here: they are never grounded.
 */
export function surfaceForms(canonical: string): string[] {
  const forms = new Set<string>([canonical]);

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(canonical);
  if (date) {
    const [, year, month, day] = date as unknown as [string, string, string, string];
    for (const d of [day, String(Number(day))]) {
      for (const m of [month, String(Number(month))]) {
        // Some layouts print a two-digit year (10.06.25).
        for (const y of [year, year.slice(2)]) {
          forms.add(`${d}.${m}.${y}`);
          forms.add(`${d}/${m}/${y}`);
          forms.add(`${d}-${m}-${y}`);
        }
      }
    }
    return [...forms];
  }

  if (/^\d{11}$/.test(canonical)) forms.add(`HR${canonical}`);
  return [...forms];
}

/** Each page's words as grounding keys, computed once per document rather than once per value. */
export function keyPages(pages: readonly (readonly string[])[]): string[][] {
  return pages.map((words) => words.map(groundingKey));
}

/**
 * Whether any of `forms` appears as a contiguous run of at most `maxRun` words on one page.
 * `pageKeys` holds each page's words in reading order, keyed by `keyPages`; a run never crosses
 * a page.
 */
export function isGrounded(
  forms: readonly string[],
  pageKeys: readonly (readonly string[])[],
  maxRun = MAX_RUN,
): boolean {
  const targets = [...new Set(forms.map(groundingKey))].filter((target) => target !== "");
  if (targets.length === 0) return false;

  return pageKeys.some((keys) =>
    keys.some((_, start) => {
      let accumulated = "";
      for (let n = 0; n < maxRun && start + n < keys.length; n++) {
        accumulated += keys[start + n];
        if (targets.includes(accumulated)) return true;
        // A run that is no target's prefix can never become one.
        if (!targets.some((target) => target.startsWith(accumulated))) return false;
      }
      return false;
    }),
  );
}
