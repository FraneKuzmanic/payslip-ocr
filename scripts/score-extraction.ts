/**
 * Score recorded Content Understanding responses against the golden set, through the REAL
 * production mapper (PRD §7.12, Task 04 D5). Offline: no network call.
 *
 *   npm run score:extraction
 *
 * Every `.bakeoff/<set>/` holding CU recordings from the configured analyzer family is a recording
 * set, of one of two kinds (Task 05 D12):
 * - single-pass: one CU body per sample, from analyzer `<AZURE_CU_ANALYZER_ID>`;
 * - two-pass: `{ timings, scalars, tables }` per sample, the bodies from `<id>_scalars` and
 *   `<id>_tables`.
 * Each set is scored. Two or more sets of a kind give a measured run-to-run spread for that kind; a
 * single run is never a ranking. Other directories are skipped by name, with the reason.
 *
 * Exit 1 means "could not measure": a recording without an expectation, an expectation without a
 * recording, a removed or unknown expectation key, a body the mapper cannot read, a directory
 * mixing analyzers or kinds, or no set at all. Targets are reported, never gated ("measure, don't
 * guarantee", PRD §11.3).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CRITICAL_FIELDS } from "@payslip/shared";
import { analyzerIdFor } from "../api/src/providers/document-extraction/content-understanding/analyzer.ts";
import { mapAnalyzeResult } from "../api/src/providers/document-extraction/content-understanding/fields.ts";
import type { ExtractionPass } from "../api/src/providers/document-extraction/types.ts";
import {
  TABLES,
  UnscoredExpectationError,
  percentiles,
  scoreSet,
  type Percentiles,
  type ScoringInput,
  type SetReport,
  type Tally,
} from "../api/src/scoring/score.ts";
import { CACHE_DIR, loadExpected, requireEnv } from "./bakeoff/common.ts";

type Kind = "single-pass" | "two-pass";

const DOCUMENTED_BAND = "~0.5%";
const analyzerId = requireEnv("AZURE_CU_ANALYZER_ID");
const SINGLE_PASS_SIGNATURE = `single:${analyzerId}`;
const TWO_PASS_SIGNATURE = `two:${analyzerIdFor(analyzerId, "scalars")}+${analyzerIdFor(analyzerId, "tables")}`;

const problems: string[] = [];
const reports: { set: string; kind: Kind; report: SetReport }[] = [];
const expectations = new Map(
  loadExpected().map((expected) => [expected.sample, expected as Record<string, unknown>]),
);

console.log(
  `\nScoring recorded responses from analyzer family '${analyzerId}' against the golden set\n`,
);

for (const { set, kind } of discoverSets()) {
  const inputs = loadSet(set, kind);
  if (inputs === null) continue;
  try {
    reports.push({ set, kind, report: scoreSet(inputs) });
  } catch (error) {
    if (!(error instanceof UnscoredExpectationError)) throw error;
    problems.push(...error.problems.map((problem) => `${set}: ${problem}`));
  }
}

if (reports.length === 0 && problems.length === 0) {
  problems.push(`no recording set from analyzer family '${analyzerId}' under .bakeoff/`);
}

for (const { set, kind, report } of reports) printSet(set, kind, report);
if (reports.length > 0) printSpread();

if (problems.length > 0) {
  console.log(`\n  !! COULD NOT MEASURE — ${problems.length} problem(s):`);
  for (const problem of problems) console.log(`     - ${problem}`);
  console.log("");
  process.exit(1);
}
console.log("");

/** Sets are recordings from the configured analyzer family; anything else is skipped by name. */
function discoverSets(): { set: string; kind: Kind }[] {
  if (!existsSync(CACHE_DIR)) return [];
  const sets: { set: string; kind: Kind }[] = [];
  for (const name of readdirSync(CACHE_DIR).toSorted()) {
    const dir = join(CACHE_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const signatures = new Set(
      jsonFiles(dir).map((file) => signatureOf(readJson(join(dir, file)))),
    );

    if (signatures.size === 0) console.log(`  skipped .bakeoff/${name}/: empty`);
    else if (signatures.size === 1 && signatures.has(null)) {
      console.log(`  skipped .bakeoff/${name}/: not Content Understanding bodies`);
    } else if (signatures.size > 1) {
      problems.push(`.bakeoff/${name}/ mixes analyzers or kinds: ${[...signatures].join(", ")}`);
    } else if (signatures.has(SINGLE_PASS_SIGNATURE)) sets.push({ set: name, kind: "single-pass" });
    else if (signatures.has(TWO_PASS_SIGNATURE)) sets.push({ set: name, kind: "two-pass" });
    else console.log(`  skipped .bakeoff/${name}/: ${[...signatures][0]}, not '${analyzerId}'`);
  }
  console.log("");
  return sets;
}

/** Which analyzers produced a recording, and in which shape. Read from the service's own bodies. */
function signatureOf(body: unknown): string | null {
  if (isCuBody(body)) return `single:${String(body.result.analyzerId ?? "(no analyzer id)")}`;
  const { scalars, tables } = (body ?? {}) as { scalars?: unknown; tables?: unknown };
  if (isCuBody(scalars) && isCuBody(tables)) {
    return `two:${String(scalars.result.analyzerId)}+${String(tables.result.analyzerId)}`;
  }
  return null;
}

function loadSet(set: string, kind: Kind): ScoringInput[] | null {
  const dir = join(CACHE_DIR, set);
  const recorded = new Set(jsonFiles(dir).map((file) => file.replace(/\.json$/, "")));
  const missing = [...expectations.keys()].filter((sample) => !recorded.has(sample));
  const orphaned = [...recorded].filter((sample) => !expectations.has(sample));
  for (const sample of missing)
    problems.push(`${set}: ${sample} has an expectation but no recording`);
  for (const sample of orphaned)
    problems.push(`${set}: ${sample} has a recording but no expectation`);
  if (missing.length > 0 || orphaned.length > 0) return null;

  const inputs: ScoringInput[] = [];
  for (const [sample, expected] of expectations) {
    const body = readJson(join(dir, `${sample}.json`));
    const input = kind === "single-pass" ? singlePass(body) : twoPass(body);
    if (input === null) {
      problems.push(`${set}: ${sample} recording is not a body the mapper can read`);
      continue;
    }
    inputs.push({ sample, expected, ...input });
  }
  return inputs.length === expectations.size ? inputs : null;
}

type Loaded = Omit<ScoringInput, "sample" | "expected">;

function singlePass(body: unknown): Loaded | null {
  const mapped = mapAnalyzeResult(body);
  if (mapped === null) return null;
  const latencyMs = (body as { latencyMs?: unknown }).latencyMs;
  return { actual: mapped.fields, latencyMs: typeof latencyMs === "number" ? latencyMs : null };
}

/** Each pass's body through the real mapper for that pass, merged as the database merges them. */
function twoPass(body: unknown): Loaded | null {
  const { scalars, tables, timings } = body as {
    scalars: unknown;
    tables: unknown;
    timings?: Record<string, { queuedMs?: unknown; latencyMs?: unknown } | undefined>;
  };
  const mappedScalars = mapAnalyzeResult(scalars, "scalars");
  const mappedTables = mapAnalyzeResult(tables, "tables");
  if (mappedScalars === null || mappedTables === null) return null;

  // Enqueue to recorded, per pass. A missing `timings` block is "not recorded", not a problem.
  const done = (pass: ExtractionPass) => {
    const { queuedMs, latencyMs } = timings?.[pass] ?? {};
    return typeof queuedMs === "number" && typeof latencyMs === "number"
      ? queuedMs + latencyMs
      : null;
  };
  const firstFormMs = done("scalars");
  const tablesMs = done("tables");
  return {
    actual: { ...mappedScalars.fields, ...mappedTables.fields },
    latencyMs: null,
    firstFormMs,
    completeMs: firstFormMs === null || tablesMs === null ? null : Math.max(firstFormMs, tablesMs),
  };
}

function printSet(set: string, kind: Kind, report: SetReport): void {
  console.log(`  ── set '${set}' (${kind}) ${"─".repeat(Math.max(0, 50 - set.length))}`);
  console.log(
    "  sample  scalars       critical  payComponents  obustave  neoporezivi  (rows: extracted/expected)",
  );
  for (const sample of report.perSample) {
    const rows = TABLES.map((table) => {
      const r = sample.rows[table];
      return (r === null ? "skipped" : `${r.actual}/${r.expected}`).padEnd(
        table === "payComponents" ? 15 : 10,
      );
    }).join("");
    console.log(
      `  ${sample.sample.padEnd(6)}  ${frac(sample.scalars).padEnd(6)} ${pct(sample.scalars).padStart(6)}  ` +
        `${frac(sample.critical).padEnd(8)}  ${rows}`,
    );
  }

  const cells = cellsOf(report);
  const rowsExact = sum(TABLES.map((table) => report.tables[table].rowsExact));
  console.log("");
  console.log(
    `  SCALAR FIELDS   ${frac(report.scalars)}  ${pct(report.scalars)}   (target >= 95%; strict on diacritics)`,
  );
  console.log(
    `  SCALAR FIELDS, bake-off-comparable (diacritic-insensitive)  ${frac(report.scalarsLenient)}  ${pct(report.scalarsLenient)}`,
  );
  console.log(`  CRITICAL FIELDS ${frac(report.critical)}  ${pct(report.critical)}`);
  console.log(
    `  LINE ITEMS      cells ${frac(cells)}  ${pct(cells)}   (target >= 85%); row count exact ${frac(rowsExact)}`,
  );
  for (const table of TABLES) {
    const { cells: c, rowsExact: r } = report.tables[table];
    console.log(
      `    ${table.padEnd(20)} cells ${frac(c).padEnd(9)} ${pct(c).padStart(6)}   rows exact ${frac(r)}`,
    );
  }
  console.log(`  BAKE-OFF COMPARABLE payComponents naziv+iznos  ${frac(report.bakeoffComparable)}`);

  if (report.skipped.length > 0) {
    console.log(`  skipped as unscorable (${report.skipped.length}):`);
    for (const { sample, field, reason } of report.skipped) {
      console.log(`    ${sample} ${field}: ${reason.slice(0, 90)}`);
    }
  }

  if (kind === "single-pass") {
    console.log(`  LATENCY         ${spreadOf(report.latency)}`);
  } else {
    console.log(`  FIRST FORM      ${spreadOf(report.firstForm)}   (target p50 <= 10s)`);
    console.log(`  COMPLETE        ${spreadOf(report.complete)}`);
    console.log(`  FIRST FORM PER PAGE  ${spreadOf(perPage(set))}`);
  }

  const worst = [...report.perField.entries()]
    .filter(([, tally]) => tally.hit < tally.total)
    .toSorted((a, b) => a[1].hit / a[1].total - b[1].hit / b[1].total)
    .slice(0, 12);
  if (worst.length > 0) {
    console.log("  Fields wrong most often:");
    for (const [field, tally] of worst) {
      const critical = (CRITICAL_FIELDS as readonly string[]).includes(field) ? "  (CRITICAL)" : "";
      console.log(`    ${field.padEnd(26)} ${frac(tally)}${critical}`);
    }
  }
  console.log("");
}

/** First form divided by the fixture's page count: PRD §11.4 states the target per page. */
function perPage(set: string): Percentiles | null {
  const values = [...expectations].map(([sample, expected]) => {
    const input = twoPass(readJson(join(CACHE_DIR, set, `${sample}.json`)));
    const pages = expected["pageCount"];
    return input?.firstFormMs == null || typeof pages !== "number"
      ? null
      : input.firstFormMs / pages;
  });
  return percentiles(values);
}

function printSpread(): void {
  for (const kind of ["single-pass", "two-pass"] as const) {
    const ofKind = reports.filter((report) => report.kind === kind);
    if (ofKind.length === 0) continue;
    if (ofKind.length === 1) {
      console.log(
        `  RUN-TO-RUN (${kind}) spread unmeasured: one set. Documented band ${DOCUMENTED_BAND} — ` +
          "differences smaller than 1–2 fields are noise.",
      );
      continue;
    }
    const hits = ofKind.map(({ report }) => report.scalars.hit);
    const total = ofKind[0]?.report.scalars.total ?? 0;
    const spread = Math.max(...hits) - Math.min(...hits);
    console.log(
      `  RUN-TO-RUN (${kind}) spread across ${ofKind.length} sets (${ofKind.map((r) => r.set).join(", ")}): ` +
        `scalars ${spread} field(s) (${((spread / total) * 100).toFixed(1)}%); documented band ` +
        `${DOCUMENTED_BAND} — differences smaller than 1–2 fields are noise.`,
    );
  }

  // Informational (Task 05 D12): the harness still gates only on "could not measure".
  const single = reports.filter((report) => report.kind === "single-pass");
  const two = reports.filter((report) => report.kind === "two-pass");
  if (two.length === 0) {
    console.log("  TWO-PASS vs SINGLE-PASS: no two-pass set");
    return;
  }
  if (single.length === 0) {
    console.log("  TWO-PASS vs SINGLE-PASS: no single-pass set to compare against");
    return;
  }
  const singleScalars = single.map(({ report }) => report.scalars.hit);
  const singleCells = single.map(({ report }) => cellsOf(report).hit);
  const floor = Math.min(...singleScalars) - 1;
  console.log(
    `  TWO-PASS vs SINGLE-PASS (single-pass range: scalars ${range(singleScalars)}, ` +
      `cells ${range(singleCells)}; scalars must stay >= ${floor}):`,
  );
  for (const { set, report } of two) {
    const verdict = report.scalars.hit >= floor ? "within the band" : "BELOW the band";
    console.log(
      `    ${set.padEnd(24)} scalars ${report.scalars.hit} (${verdict})  cells ${cellsOf(report).hit}`,
    );
  }
}

function range(values: number[]): string {
  return `${Math.min(...values)}–${Math.max(...values)}`;
}

function cellsOf(report: SetReport): Tally {
  return sum(TABLES.map((table) => report.tables[table].cells));
}

function spreadOf(value: Percentiles | null): string {
  return value === null
    ? "not recorded"
    : `p50 ${secs(value.p50)}  p90 ${secs(value.p90)}  max ${secs(value.max)}`;
}

function isCuBody(body: unknown): body is { result: { analyzerId?: unknown; contents: unknown } } {
  const result = (body as { result?: { contents?: unknown } } | null)?.result;
  return typeof result === "object" && result !== null && Array.isArray(result.contents);
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .toSorted();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sum(tallies: Tally[]): Tally {
  return tallies.reduce((a, b) => ({ hit: a.hit + b.hit, total: a.total + b.total }), {
    hit: 0,
    total: 0,
  });
}

function frac({ hit, total }: Tally): string {
  return `${hit}/${total}`;
}

function pct({ hit, total }: Tally): string {
  return total === 0 ? "n/a" : `${((hit / total) * 100).toFixed(1)}%`;
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
