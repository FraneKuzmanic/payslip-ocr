/**
 * Score recorded Content Understanding responses against the golden set, through the REAL
 * production mapper (PRD §7.12, Task 04 D5). Offline: no network call.
 *
 *   npm run score:extraction
 *
 * Every `.bakeoff/<set>/` holding CU bodies from the configured analyzer is a recording set, and
 * each is scored. Two or more sets give a measured run-to-run spread; a single run is never a
 * ranking. Other directories are skipped by name, with the reason.
 *
 * Exit 1 means "could not measure": a recording without an expectation, an expectation without a
 * recording, a removed or unknown expectation key, a body the mapper cannot read, or no set at
 * all. Targets are reported, never gated ("measure, don't guarantee", PRD §11.3).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CRITICAL_FIELDS } from "@payslip/shared";
import { mapAnalyzeResult } from "../api/src/providers/document-extraction/content-understanding/fields.ts";
import {
  TABLES,
  UnscoredExpectationError,
  scoreSet,
  type ScoringInput,
  type SetReport,
  type Tally,
} from "../api/src/scoring/score.ts";
import { CACHE_DIR, loadExpected, requireEnv } from "./bakeoff/common.ts";

const DOCUMENTED_BAND = "~0.5%";
const analyzerId = requireEnv("AZURE_CU_ANALYZER_ID");

const problems: string[] = [];
const reports: { set: string; report: SetReport }[] = [];
const expectations = new Map(
  loadExpected().map((expected) => [expected.sample, expected as Record<string, unknown>]),
);

console.log(`\nScoring recorded responses from analyzer '${analyzerId}' against the golden set\n`);

for (const set of discoverSets()) {
  const inputs = loadSet(set);
  if (inputs === null) continue;
  try {
    reports.push({ set, report: scoreSet(inputs) });
  } catch (error) {
    if (!(error instanceof UnscoredExpectationError)) throw error;
    problems.push(...error.problems.map((problem) => `${set}: ${problem}`));
  }
}

if (reports.length === 0 && problems.length === 0) {
  problems.push(`no recording set from analyzer '${analyzerId}' under .bakeoff/`);
}

for (const { set, report } of reports) printSet(set, report);
if (reports.length > 0) printSpread();

if (problems.length > 0) {
  console.log(`\n  !! COULD NOT MEASURE — ${problems.length} problem(s):`);
  for (const problem of problems) console.log(`     - ${problem}`);
  console.log("");
  process.exit(1);
}
console.log("");

/** Sets are CU bodies from the configured analyzer; anything else is skipped by name. */
function discoverSets(): string[] {
  if (!existsSync(CACHE_DIR)) return [];
  const sets: string[] = [];
  for (const name of readdirSync(CACHE_DIR).toSorted()) {
    const dir = join(CACHE_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const bodies = jsonFiles(dir).map((file) => readJson(join(dir, file)));
    // Read from the service's own body: only the bake-off's cache writer added a top-level id.
    const analyzers = new Set(
      bodies.map((body) =>
        isCuBody(body) ? String(body.result.analyzerId ?? "(no analyzer id)") : null,
      ),
    );

    if (bodies.length === 0) console.log(`  skipped .bakeoff/${name}/: empty`);
    else if (analyzers.size === 1 && analyzers.has(null)) {
      console.log(`  skipped .bakeoff/${name}/: not Content Understanding bodies`);
    } else if (analyzers.size > 1) {
      problems.push(`.bakeoff/${name}/ mixes analyzers: ${[...analyzers].join(", ")}`);
    } else if (!analyzers.has(analyzerId)) {
      console.log(
        `  skipped .bakeoff/${name}/: analyzer '${[...analyzers][0]}', not '${analyzerId}'`,
      );
    } else sets.push(name);
  }
  console.log("");
  return sets;
}

function loadSet(set: string): ScoringInput[] | null {
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
    const mapped = mapAnalyzeResult(body);
    if (mapped === null) {
      problems.push(`${set}: ${sample} recording is not a body the mapper can read`);
      continue;
    }
    const latencyMs = (body as { latencyMs?: unknown }).latencyMs;
    inputs.push({
      sample,
      expected,
      actual: mapped.fields,
      latencyMs: typeof latencyMs === "number" ? latencyMs : null,
    });
  }
  return inputs.length === expectations.size ? inputs : null;
}

function printSet(set: string, report: SetReport): void {
  console.log(`  ── set '${set}' ${"─".repeat(Math.max(0, 60 - set.length))}`);
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

  const cells = sum(TABLES.map((table) => report.tables[table].cells));
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

  const { latency } = report;
  console.log(
    latency === null
      ? "  LATENCY         not recorded"
      : `  LATENCY         p50 ${secs(latency.p50)}  p90 ${secs(latency.p90)}  max ${secs(latency.max)}`,
  );

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

function printSpread(): void {
  if (reports.length === 1) {
    console.log(
      `  RUN-TO-RUN spread unmeasured: one set. Documented band ${DOCUMENTED_BAND} — ` +
        "differences smaller than 1–2 fields are noise.",
    );
    return;
  }
  const hits = reports.map(({ report }) => report.scalars.hit);
  const total = reports[0]?.report.scalars.total ?? 0;
  const spread = Math.max(...hits) - Math.min(...hits);
  console.log(
    `  RUN-TO-RUN spread across ${reports.length} sets (${reports.map((r) => r.set).join(", ")}): ` +
      `scalars ${spread} field(s) (${((spread / total) * 100).toFixed(1)}%); documented band ` +
      `${DOCUMENTED_BAND} — differences smaller than 1–2 fields are noise.`,
  );
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
