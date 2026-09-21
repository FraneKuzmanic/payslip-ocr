/**
 * Re-ground an extracted value to pixels by matching it back against OCR word geometry.
 *
 * The challenger's LLM reads markdown and returns values with no coordinates, so a highlight
 * only exists if we can find the value again among the layout words. A value that CANNOT be
 * grounded is also a useful signal: it means the model produced something the page does not
 * literally contain.
 *
 * Output coordinates are page-relative fractions in [0,1] — the same normalisation the app
 * uses, which is what makes inch-based PDFs and pixel-based photos interchangeable.
 */

export interface LayoutWord {
  content: string;
  polygon: number[]; // [x1,y1,x2,y2,x3,y3,x4,y4]
  pageNumber: number;
}

export interface LayoutPage {
  pageNumber: number;
  width: number;
  height: number;
}

export interface Region {
  page: number;
  corners: { x: number; y: number }[];
  matchedText: string;
}

export const CROATIAN_MONTHS = [
  "siječanj", "veljača", "ožujak", "travanj", "svibanj", "lipanj",
  "srpanj", "kolovoz", "rujan", "listopad", "studeni", "prosinac",
];

/**
 * Croatian surface forms a canonical value might be printed as.
 *
 * Canonical values are normalised (2025-05, 2025-06-09, 1234.56) but pages print them
 * as svibanj 2025, 09.06.2025 and 1.234,56. Without this the grounder misses every date.
 */
export function surfaceForms(canonical: string): string[] {
  const forms = new Set<string>([canonical]);

  // period: YYYY-MM
  const period = /^(\d{4})-(\d{2})$/.exec(canonical);
  if (period) {
    const [, y, mm] = period;
    const m = Number(mm);
    forms.add(`${CROATIAN_MONTHS[m - 1]} ${y}`);
    forms.add(`${CROATIAN_MONTHS[m - 1]}${y}`);
    forms.add(`${mm}/${y}`);
    forms.add(`${m}/${y}`);
    forms.add(`${mm}.${y}`);
    forms.add(`${m}.${y}`);
    forms.add(`${y}-${mm}`);
    return [...forms];
  }

  // date: YYYY-MM-DD -> DD.MM.YYYY and friends
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(canonical);
  if (date) {
    const [, y, mm, dd] = date;
    const d = String(Number(dd));
    const m = String(Number(mm));
    const yy = y!.slice(2); // some layouts print 10.06.25
    for (const day of [dd!, d]) {
      for (const mon of [mm!, m]) {
        for (const year of [y!, yy]) {
          forms.add(`${day}.${mon}.${year}`);
          forms.add(`${day}.${mon}.${year}.`);
          forms.add(`${day}/${mon}/${year}`);
          forms.add(`${day}-${mon}-${year}`);
        }
      }
    }
    return [...forms];
  }

  // OIB printed with an HR (VAT) prefix
  if (/^\d{11}$/.test(canonical)) forms.add(`HR${canonical}`);

  if (/^-?\d+(\.\d+)?$/.test(canonical)) {
    const [intPart, decPart = ""] = canonical.split(".");
    const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const dec2 = decPart.padEnd(2, "0").slice(0, 2);
    forms.add(`${grouped},${dec2}`); // 1.234,56
    forms.add(`${intPart},${dec2}`); // 1234,56
    forms.add(`${intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec2}`); // 1 234,56
    if (decPart === "" || /^0+$/.test(decPart)) {
      forms.add(grouped);
      forms.add(intPart!);
    }
  }
  return [...forms];
}

const strip = (s: string): string => s.replace(/[\s ]/g, "");

/**
 * Comparison key: diacritic-, case-, whitespace- and separator-insensitive.
 *
 * Dropping `.` and `,` is what lets canonical "1234.56" meet printed "1.234,56" without
 * relying on surface forms, and also absorbs the trailing full stop Croatian payslips put
 * after a period ("svibanj 2025.") and the comma lost when an address wraps a line.
 *
 * Trade-off: an 11-digit OIB could in principle collide with a formatted amount. In practice
 * the fields are matched independently and a wrong box is visible, not silent.
 */
function key(s: string): string {
  return strip(s)
    .replace(/[.,;:]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

function envelope(words: LayoutWord[], page: LayoutPage): { x: number; y: number }[] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of words) {
    for (let i = 0; i < w.polygon.length; i += 2) {
      xs.push(w.polygon[i]!);
      ys.push(w.polygon[i + 1]!);
    }
  }
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const x0 = clamp(Math.min(...xs) / page.width);
  const x1 = clamp(Math.max(...xs) / page.width);
  const y0 = clamp(Math.min(...ys) / page.height);
  const y1 = clamp(Math.max(...ys) / page.height);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Find `value` among the words. Returns every match (so the caller can see when a value is
 * ambiguous — "0,00" appears a dozen times on a payslip) with the first as the best guess.
 *
 * Multi-word values are matched as a contiguous run within a single page, and a run that
 * crosses a line is returned as one envelope per line rather than one box spanning the gap.
 */
export function groundValue(
  value: string,
  words: LayoutWord[],
  pages: LayoutPage[],
  opts: { maxRun?: number } = {},
): Region[] {
  if (!value) return [];
  const maxRun = opts.maxRun ?? 12;
  const targets = surfaceForms(value).map(key).filter(Boolean);
  if (!targets.length) return [];

  const byPage = new Map<number, LayoutPage>(pages.map((p) => [p.pageNumber, p]));
  const out: Region[] = [];

  for (let i = 0; i < words.length; i++) {
    const page = byPage.get(words[i]!.pageNumber);
    if (!page) continue;
    let acc = "";
    for (let n = 0; n < maxRun && i + n < words.length; n++) {
      const w = words[i + n]!;
      if (w.pageNumber !== words[i]!.pageNumber) break;
      acc += key(w.content);
      if (acc.length > 200) break;
      if (targets.includes(acc)) {
        const run = words.slice(i, i + n + 1);
        out.push({ page: page.pageNumber, corners: envelope(run, page), matchedText: run.map((r) => r.content).join(" ") });
        break;
      }
    }
  }
  return out;
}

export interface GroundingReport {
  grounded: number;
  ungrounded: string[];
  ambiguous: string[];
  regions: Record<string, Region>;
}

/** Ground every non-null scalar field of an extraction. */
export function groundExtraction(
  fields: Record<string, unknown>,
  words: LayoutWord[],
  pages: LayoutPage[],
): GroundingReport {
  const regions: Record<string, Region> = {};
  const ungrounded: string[] = [];
  const ambiguous: string[] = [];

  for (const [name, raw] of Object.entries(fields)) {
    if (raw === null || raw === undefined || typeof raw === "object") continue;
    const value = String(raw);
    if (!value.trim()) continue;
    const hits = groundValue(value, words, pages);
    if (hits.length === 0) {
      ungrounded.push(name);
    } else {
      regions[name] = hits[0]!;
      if (hits.length > 1) ambiguous.push(name);
    }
  }
  return { grounded: Object.keys(regions).length, ungrounded, ambiguous, regions };
}

/** Pull words + page dimensions out of a cached DI layout response. */
export function layoutGeometry(raw: {
  analyzeResult?: {
    pages?: {
      pageNumber: number;
      width: number;
      height: number;
      words?: { content: string; polygon: number[] }[];
    }[];
  };
}): { words: LayoutWord[]; pages: LayoutPage[] } {
  const src = raw.analyzeResult?.pages ?? [];
  const pages: LayoutPage[] = src
    .filter((p) => p.width > 0 && p.height > 0)
    .map((p) => ({ pageNumber: p.pageNumber, width: p.width, height: p.height }));
  const words: LayoutWord[] = [];
  for (const p of src) {
    for (const w of p.words ?? []) {
      words.push({ content: w.content, polygon: w.polygon, pageNumber: p.pageNumber });
    }
  }
  return { words, pages };
}
