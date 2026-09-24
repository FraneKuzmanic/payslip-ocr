import {
  CRITICAL_FIELDS,
  amountsEqual,
  canonicalPayslipFieldsSchema,
  type CanonicalPayslipFields,
} from "@payslip/shared";

/**
 * Extraction scoring against the golden set (PRD §7.12, Task 04 D5). Provider-neutral: it reads
 * canonical fields only, so the same code scores any engine's mapped output.
 *
 * Scored PER FIELD INSTANCE (ROADMAP locked decision 15). Anything that cannot be scored is a
 * loud failure, never a skip: a harness that silently drops what it cannot measure reports the
 * health of the corpus it kept. Only a fixture's declared `unscorable` fields are skipped, and
 * they are listed.
 */

export const TABLE_COLUMNS = {
  payComponents: ["naziv", "sati", "koeficijent", "iznos"],
  obustave: ["naziv", "vjerovnik", "iznos", "ostatakSalda", "brojRata"],
  neoporeziviPrimici: ["naziv", "iznos"],
} as const;

export type Table = keyof typeof TABLE_COLUMNS;
export const TABLES = Object.keys(TABLE_COLUMNS) as Table[];

/** The 25 canonical scalars. `currency` is envelope (Task 02 D3), so it is not scored. */
export const SCALAR_FIELDS = Object.keys(canonicalPayslipFieldsSchema.shape).filter(
  (key) => !(TABLES as string[]).includes(key),
);

/** Keys a fixture carries about itself; the same list as `shared/src/payslip.test.ts`. */
export const FIXTURE_METADATA_KEYS = [
  "sample",
  "sourceFile",
  "layoutFamily",
  "layoutName",
  "sourceKind",
  "pageCount",
  "currency",
  "notes",
  "unscorable",
];

const EXACT_FIELDS = new Set(["period", "paymentDate"]);
const TEXT_FIELDS = new Set([
  "employerName",
  "employerAddress",
  "employerOib",
  "employerIban",
  "employeeName",
  "employeeAddress",
  "employeeOib",
  "employeeIban",
  // Table columns.
  "naziv",
  "vjerovnik",
  "brojRata",
]);

export interface Tally {
  hit: number;
  total: number;
}

export interface ScoringInput {
  readonly sample: string;
  readonly expected: Record<string, unknown>;
  readonly actual: CanonicalPayslipFields;
  readonly latencyMs: number | null;
}

export interface SampleReport {
  readonly sample: string;
  readonly scalars: Tally;
  readonly critical: Tally;
  /** `null` for a table declared unscorable. */
  readonly rows: Record<Table, { actual: number; expected: number } | null>;
  readonly wrong: string[];
}

export interface SetReport {
  /** Strict on diacritics: the headline, and the one the ≥95% target reads. */
  readonly scalars: Tally;
  /** Diacritic-insensitive, as the bake-off compared, so past figures stay comparable. */
  readonly scalarsLenient: Tally;
  readonly critical: Tally;
  readonly tables: Record<Table, { rowsExact: Tally; cells: Tally }>;
  /** `payComponents` `naziv` + `iznos` cells, compared as the bake-off did (170/180 there). */
  readonly bakeoffComparable: Tally;
  readonly perField: Map<string, Tally>;
  readonly skipped: { sample: string; field: string; reason: string }[];
  readonly latency: { p50: number; p90: number; max: number } | null;
  readonly perSample: SampleReport[];
}

export class UnscoredExpectationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`${problems.length} expectation(s) could not be scored`);
    this.name = "UnscoredExpectationError";
    this.problems = problems;
  }
}

/** Throws `UnscoredExpectationError` naming every problem, never the first only. */
export function scoreSet(inputs: readonly ScoringInput[]): SetReport {
  const problems = inputs.flatMap(findProblems);
  if (problems.length > 0) throw new UnscoredExpectationError(problems);

  const scalars = tally();
  const scalarsLenient = tally();
  const critical = tally();
  const bakeoffComparable = tally();
  const tables = Object.fromEntries(
    TABLES.map((table) => [table, { rowsExact: tally(), cells: tally() }]),
  ) as SetReport["tables"];
  const perField = new Map<string, Tally>();
  const skipped: SetReport["skipped"] = [];
  const perSample: SampleReport[] = [];

  for (const { sample, expected, actual } of inputs) {
    const unscorable = new Map(unscorableOf(expected).map((entry) => [entry.field, entry.reason]));
    for (const [field, reason] of unscorable) skipped.push({ sample, field, reason });

    const sampleScalars = tally();
    const sampleCritical = tally();
    const wrong: string[] = [];

    for (const field of SCALAR_FIELDS) {
      if (unscorable.has(field)) continue;
      const want = expected[field];
      const got = actual[field as keyof CanonicalPayslipFields];
      const good = matches(field, want, got, "strict");

      count(scalars, good);
      count(sampleScalars, good);
      count(scalarsLenient, matches(field, want, got, "lenient"));
      const fieldTally = perField.get(field) ?? tally();
      count(fieldTally, good);
      perField.set(field, fieldTally);
      if ((CRITICAL_FIELDS as readonly string[]).includes(field)) {
        count(critical, good);
        count(sampleCritical, good);
      }
      if (!good) wrong.push(field);
    }

    const rows = {} as SampleReport["rows"];
    for (const table of TABLES) {
      if (unscorable.has(table)) {
        rows[table] = null;
        continue;
      }
      const want = rowsOf(expected[table]);
      const got = rowsOf(actual[table]);
      rows[table] = { actual: got.length, expected: want.length };
      count(tables[table].rowsExact, want.length === got.length);

      // Positional: a missing actual row makes every cell of that expected row a miss, and extra
      // actual rows count only against the row-count figure.
      want.forEach((wantRow, index) => {
        const gotRow = got[index];
        for (const column of TABLE_COLUMNS[table]) {
          count(tables[table].cells, matches(column, wantRow[column], gotRow?.[column], "strict"));
          if (table === "payComponents" && (column === "naziv" || column === "iznos")) {
            count(bakeoffComparable, matches(column, wantRow[column], gotRow?.[column], "lenient"));
          }
        }
      });
    }

    perSample.push({ sample, scalars: sampleScalars, critical: sampleCritical, rows, wrong });
  }

  return {
    scalars,
    scalarsLenient,
    critical,
    tables,
    bakeoffComparable,
    perField,
    skipped,
    latency: percentiles(inputs.map((input) => input.latencyMs)),
    perSample,
  };
}

function findProblems({ sample, expected }: ScoringInput): string[] {
  const problems: string[] = [];
  const canonical = [...SCALAR_FIELDS, ...TABLES];
  const unscorable = new Set(unscorableOf(expected).map((entry) => entry.field));

  for (const field of unscorable) {
    if (!canonical.includes(field))
      problems.push(`${sample}: unscorable names unknown field '${field}'`);
  }
  for (const key of Object.keys(expected)) {
    if (!canonical.includes(key) && !FIXTURE_METADATA_KEYS.includes(key)) {
      problems.push(`${sample}: expectation carries unknown key '${key}'`);
    }
  }
  for (const field of canonical) {
    // `undefined` is a removed expectation; `null` is the expectation "not on the document".
    if (!unscorable.has(field) && !(field in expected)) {
      problems.push(`${sample}: expectation has no '${field}'`);
    }
  }
  for (const table of TABLES) {
    if (unscorable.has(table) || !(table in expected)) continue;
    const value = expected[table];
    if (value !== null && !Array.isArray(value)) {
      problems.push(`${sample}: expectation '${table}' is neither a list nor null`);
    }
    rowsOf(value).forEach((row, index) => {
      const columns: readonly string[] = TABLE_COLUMNS[table];
      for (const column of columns) {
        if (!(column in row))
          problems.push(`${sample}: expectation has no '${table}.${index}.${column}'`);
      }
      for (const key of Object.keys(row)) {
        if (!columns.includes(key))
          problems.push(`${sample}: expectation carries unknown key '${table}.${index}.${key}'`);
      }
    });
  }
  return problems;
}

function unscorableOf(expected: Record<string, unknown>): { field: string; reason: string }[] {
  const entries = expected["unscorable"];
  return Array.isArray(entries) ? (entries as { field: string; reason: string }[]) : [];
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

type Mode = "strict" | "lenient";

function matches(field: string, want: unknown, got: unknown, mode: Mode): boolean {
  const expected = want ?? null;
  const actual = got ?? null;
  if (expected === null || actual === null) return expected === actual;
  if (typeof expected !== "string" || typeof actual !== "string") return false;

  if (EXACT_FIELDS.has(field)) return expected === actual;
  if (TEXT_FIELDS.has(field)) {
    const key = mode === "strict" ? strictTextKey : textKey;
    return key(expected) === key(actual);
  }
  return amountsEqual(expected, actual);
}

/**
 * Case, spacing and punctuation are ignored; **diacritics are not** (product-owner decision,
 * 2026-09-24): a wrong `č/ć/ž/š/đ` in a name is an error the user must correct.
 */
export function strictTextKey(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The bake-off's comparison (`scripts/bakeoff/score.ts`): diacritic-insensitive. */
export function textKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/** Nearest-rank percentiles over the recordings that carry a latency. */
export function percentiles(
  values: readonly (number | null)[],
): { p50: number; p90: number; max: number } | null {
  const sorted = values
    .filter((value): value is number => value !== null)
    .toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return { p50: rank(0.5), p90: rank(0.9), max: sorted.at(-1) ?? 0 };
}

function tally(): Tally {
  return { hit: 0, total: 0 };
}

function count(target: Tally, good: boolean): void {
  target.total++;
  if (good) target.hit++;
}
