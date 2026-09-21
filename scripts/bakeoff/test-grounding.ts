/**
 * Upper bound on the challenger's highlighting ability.
 *
 * Grounds the GOLDEN SET's known-correct values against the cached DI layout words. Because
 * the values are correct by construction, whatever fails here is a limit of the grounding
 * approach itself, not of the model — no LLM can beat this number.
 */
import { loadExpected, readCache, SCALAR_FIELDS, CRITICAL_FIELDS } from "./common.ts";
import { groundValue, layoutGeometry } from "./ground.ts";

const samples = loadExpected();
let total = 0;
let grounded = 0;
let ambiguous = 0;
const failuresByField = new Map<string, number>();
const totalByField = new Map<string, number>();

console.log("\nGrounding golden-set values against cached DI layout words\n");
console.log("  sample  grounded        ambiguous  ungrounded fields");
console.log("  " + "-".repeat(76));

for (const e of samples) {
  const raw = readCache<Record<string, unknown>>("layout", e.sample);
  if (!raw || (raw as { failed?: boolean }).failed) {
    console.log(`  ${e.sample.padEnd(6)}  NO LAYOUT CACHE — run \`npm run layout\` first`);
    continue;
  }
  const { words, pages } = layoutGeometry(raw as never);

  const missing: string[] = [];
  let ok = 0;
  let n = 0;
  let amb = 0;

  for (const f of SCALAR_FIELDS) {
    const v = e[f];
    if (v === null || v === undefined || v === "") continue;
    if (f === "currency") continue; // never printed as a standalone token
    n++;
    totalByField.set(f, (totalByField.get(f) ?? 0) + 1);
    const hits = groundValue(String(v), words, pages);
    if (hits.length > 0) {
      ok++;
      if (hits.length > 1) amb++;
    } else {
      missing.push(f);
      failuresByField.set(f, (failuresByField.get(f) ?? 0) + 1);
    }
  }

  total += n;
  grounded += ok;
  ambiguous += amb;
  const pct = n ? Math.round((ok / n) * 100) : 0;
  console.log(
    `  ${e.sample.padEnd(6)}  ${String(ok).padStart(2)}/${String(n).padEnd(2)} (${String(pct).padStart(3)}%)   ` +
      `${String(amb).padStart(2)} multi   ${missing.join(", ") || "—"}`,
  );
}

console.log("  " + "-".repeat(76));
const pct = total ? ((grounded / total) * 100).toFixed(1) : "0";
console.log(`\n  GROUNDED ${grounded}/${total} (${pct}%)   ambiguous (>1 match on page): ${ambiguous}\n`);

if (failuresByField.size) {
  console.log("  Hardest fields to ground:");
  [...failuresByField.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([f, c]) => {
      const t = totalByField.get(f) ?? 0;
      const crit = CRITICAL_FIELDS.includes(f as never) ? " (CRITICAL)" : "";
      console.log(`    ${f.padEnd(26)} failed ${c}/${t}${crit}`);
    });
  console.log("");
}
