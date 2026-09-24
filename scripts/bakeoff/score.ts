/**
 * Score an engine's cached extractions against the golden set.
 *
 * Scored PER FIELD INSTANCE, not per document — at 11 documents a per-document rate moves
 * nine points on a single bad file. Fields listed in a fixture's `unscorable` are skipped
 * explicitly and reported; anything else that cannot be scored is a loud failure, because a
 * harness that silently drops what it cannot measure reports the health of the corpus it kept.
 */
import { loadExpected, readCache, SCALAR_FIELDS, CRITICAL_FIELDS } from "./common.ts";

const engine = process.argv[2] ?? "llm";
const isCu = engine.startsWith("cu");
const verbose = process.argv.includes("--verbose");

const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** Croatian or canonical numeric string -> number, else null. */
function num(s: string): number | null {
  const t = s.replace(/[\s €]/g, "").replace(/(EUR|HRK)$/i, "");
  // 1.234,56 -> 1234.56 ; 1234,56 -> 1234.56 ; 1234.56 stays
  const canon = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^-?\d+(\.\d+)?$/.test(canon)) return null;
  const n = Number(canon);
  return Number.isFinite(n) ? n : null;
}

const textKey = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const MONTHS = [
  "siječanj",
  "veljača",
  "ožujak",
  "travanj",
  "svibanj",
  "lipanj",
  "srpanj",
  "kolovoz",
  "rujan",
  "listopad",
  "studeni",
  "prosinac",
];

/**
 * Canonicalise a printed date/period to the golden set's form.
 *
 * Content Understanding returns what the page prints ("svibanj 2025.", "09.06.2025") rather
 * than an ISO value, which is defensible behaviour for an extractor — normalisation is the
 * mapper's job, not the engine's. Comparing raw would score a formatting choice as a reading
 * error, so both sides are canonicalised here.
 */
function asDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\.?$/.exec(t);
  if (dmy) {
    const [, d, m, y] = dmy;
    const yyyy = y!.length === 2 ? `20${y}` : y!;
    return `${yyyy}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  return null;
}

function asPeriod(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const named = new RegExp(`(${MONTHS.join("|")})\\s*(\\d{4})`).exec(t);
  if (named) return `${named[2]}-${String(MONTHS.indexOf(named[1]!) + 1).padStart(2, "0")}`;
  const god = /godina\s*(\d{4}).*?mjesec\s*(\d{1,2})/.exec(t);
  if (god) return `${god[1]}-${god[2]!.padStart(2, "0")}`;
  const godNamed = new RegExp(`godina\\s*(\\d{4}).*?mjesec\\s*(${MONTHS.join("|")})`).exec(t);
  if (godNamed)
    return `${godNamed[1]}-${String(MONTHS.indexOf(godNamed[2]!) + 1).padStart(2, "0")}`;
  // "1.05.2025 do 31.05.2025" -> take the first date's year-month
  const span = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(t);
  if (span) return `${span[3]}-${span[2]!.padStart(2, "0")}`;
  const slash = /^(\d{1,2})[./](\d{4})$/.exec(t);
  if (slash) return `${slash[2]}-${slash[1]!.padStart(2, "0")}`;
  return null;
}

const cy = (v: string): string => (v === "€" ? "EUR" : v === "kn" ? "HRK" : v.toUpperCase());

function matches(expected: unknown, actual: unknown, field?: string): boolean {
  const e = norm(expected);
  const a = norm(actual);
  if (e === null && a === null) return true;
  if (e === null || a === null) return false;

  if (field === "period") {
    const ep = asPeriod(e);
    const ap = asPeriod(a);
    if (ep && ap) return ep === ap;
  }
  if (field === "paymentDate") {
    const ed = asDate(e);
    const ad = asDate(a);
    if (ed && ad) return ed === ad;
  }
  if (field === "currency") {
    return cy(e) === cy(a);
  }

  const en = num(e);
  const an = num(a);
  if (en !== null && an !== null) return Math.abs(en - an) <= 0.011;
  return textKey(e) === textKey(a);
}

/** Pull the engine's canonical fields out of its cached response. */
function extractedFields(sample: string): Record<string, unknown> | null {
  const raw = readCache<Record<string, unknown>>(engine, sample);
  if (!raw) return null;
  if (!isCu) return (raw["fields"] as Record<string, unknown>) ?? null;

  // Content Understanding: result.contents[].fields[name].value*
  const contents =
    (raw["result"] as { contents?: { fields?: Record<string, Record<string, unknown>> }[] })
      ?.contents ?? [];
  const fields = contents[0]?.fields;
  if (!fields) return null;
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(fields)) {
    if (f["valueArray"]) {
      out[name] = (
        f["valueArray"] as { valueObject?: Record<string, Record<string, unknown>> }[]
      ).map((row) =>
        Object.fromEntries(
          Object.entries(row.valueObject ?? {}).map(([k, v]) => [
            k,
            v["valueString"] ?? v["value"] ?? null,
          ]),
        ),
      );
    } else {
      out[name] = f["valueString"] ?? f["value"] ?? null;
    }
  }
  return out;
}

const samples = loadExpected();
let sTotal = 0;
let sHit = 0;
let cTotal = 0;
let cHit = 0;
let skipped = 0;
let unscored = 0;
const perField = new Map<string, { hit: number; total: number }>();
const rowStats = { exact: 0, docs: 0, cellHit: 0, cellTotal: 0 };

console.log(`\nScoring engine '${engine}' against the golden set\n`);
console.log("  sample  scalars        critical   payComponents");
console.log("  " + "-".repeat(72));

for (const e of samples) {
  const got = extractedFields(e.sample);
  if (!got) {
    console.log(`  ${e.sample.padEnd(6)}  NO CACHED RESULT — engine did not produce output`);
    unscored++;
    continue;
  }
  const skip = new Set(
    (e["unscorable"] as { field: string }[] | undefined)?.map((u) => u.field) ?? [],
  );

  let n = 0;
  let hit = 0;
  let cn = 0;
  let ch = 0;
  const wrong: string[] = [];

  for (const f of SCALAR_FIELDS) {
    if (skip.has(f)) {
      skipped++;
      continue;
    }
    n++;
    const good = matches(e[f], got[f], f);
    if (good) hit++;
    else wrong.push(f);
    const pf = perField.get(f) ?? { hit: 0, total: 0 };
    pf.total++;
    if (good) pf.hit++;
    perField.set(f, pf);
    if (CRITICAL_FIELDS.includes(f as never)) {
      cn++;
      if (good) ch++;
    }
  }

  sTotal += n;
  sHit += hit;
  cTotal += cn;
  cHit += ch;

  // payComponents: row count + per-cell amounts
  let rowNote = "skipped";
  if (!skip.has("payComponents")) {
    const exp = (e["payComponents"] as { naziv?: string; iznos?: string }[]) ?? [];
    const act = (got["payComponents"] as { naziv?: string; iznos?: string }[] | null) ?? [];
    rowStats.docs++;
    if (exp.length === act.length) rowStats.exact++;
    for (let i = 0; i < exp.length; i++) {
      rowStats.cellTotal += 2;
      if (matches(exp[i]?.naziv, act[i]?.naziv)) rowStats.cellHit++;
      if (matches(exp[i]?.iznos, act[i]?.iznos)) rowStats.cellHit++;
    }
    rowNote = `${act.length}/${exp.length} rows`;
  }

  console.log(
    `  ${e.sample.padEnd(6)}  ${String(hit).padStart(2)}/${String(n).padEnd(2)} (${String(Math.round((hit / n) * 100)).padStart(3)}%)   ` +
      `${ch}/${cn}        ${rowNote}` +
      (verbose && wrong.length ? `\n            wrong: ${wrong.join(", ")}` : ""),
  );
}

console.log("  " + "-".repeat(72));
const pct = (h: number, t: number): string => (t ? ((h / t) * 100).toFixed(1) : "0.0");
console.log(`\n  SCALAR FIELDS   ${sHit}/${sTotal}  ${pct(sHit, sTotal)}%     (target >= 95%)`);
console.log(`  CRITICAL FIELDS ${cHit}/${cTotal}  ${pct(cHit, cTotal)}%`);
console.log(
  `  LINE ITEMS      row-count exact on ${rowStats.exact}/${rowStats.docs} docs; ` +
    `cells ${rowStats.cellHit}/${rowStats.cellTotal} ${pct(rowStats.cellHit, rowStats.cellTotal)}%   (target >= 85%)`,
);
console.log(`  skipped (declared unscorable): ${skipped}`);
if (unscored) console.log(`  !! ${unscored} sample(s) produced NO output and were not scored`);

const worst = [...perField.entries()]
  .filter(([, v]) => v.hit < v.total)
  .toSorted((a, b) => a[1].hit / a[1].total - b[1].hit / b[1].total);
if (worst.length) {
  console.log(`\n  Fields the engine gets wrong most often:`);
  for (const [f, v] of worst.slice(0, 12)) {
    const crit = CRITICAL_FIELDS.includes(f as never) ? "  (CRITICAL)" : "";
    console.log(`    ${f.padEnd(26)} ${v.hit}/${v.total}${crit}`);
  }
}
console.log("");
