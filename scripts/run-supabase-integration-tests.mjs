import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Two named targets, never an automatic fallback between them. A developer who believes they are
// writing to a disposable local database while actually writing to the real project is exactly the
// failure this split exists to prevent, so the resolved host is always printed before any test runs.
const useLocal = process.argv.includes("--local");
// The paid golden run (Task 04 D17): hosted only, because it calls the real extraction service.
const extraction = process.argv.includes("--extraction");

if (extraction && useLocal) {
  console.error("The extraction golden run is hosted only; it cannot run with --local.");
  process.exit(1);
}

const supabaseEntry = resolve("node_modules", "supabase", "dist", "supabase.js");
const vitestEntry = resolve("node_modules", "vitest", "vitest.mjs");

const target = useLocal ? resolveLocalTarget() : resolveHostedTarget();

console.log(`\nSupabase integration tests → ${target.label}: ${hostOf(target.env.SUPABASE_URL)}\n`);
if (extraction) {
  // Task 05 D13: the golden run's mode and the recording set it writes, passed through process.env.
  console.log(
    `Golden run: GOLDEN_MODE=${process.env.GOLDEN_MODE ?? "concurrent"}, ` +
      `GOLDEN_SET=${process.env.GOLDEN_SET ?? "(unset)"}\n`,
  );
}

const integrationFiles = extraction
  ? ["src/routes/extraction.integration.ts"]
  : [
      "src/auth/auth.integration.ts",
      "src/routes/payslips.integration.ts",
      "src/routes/direct-writes.integration.ts",
    ];

for (const file of integrationFiles) {
  const test = spawnSync(
    process.execPath,
    [vitestEntry, "run", file, "--config", "api/vitest.integration.config.ts"],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ...target.env },
    },
  );

  if (test.status !== 0) process.exit(test.status ?? 1);
}

/** The Docker-backed stack. Required for schema work; it issues symmetric JWTs, not ES256. */
function resolveLocalTarget() {
  const status = spawnSync(process.execPath, [supabaseEntry, "status", "-o", "json"], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (status.status !== 0) {
    console.error("Local Supabase is not running. Start it with npm run db:start.");
    process.exit(status.status ?? 1);
  }

  let local;
  try {
    local = JSON.parse(status.stdout);
  } catch {
    console.error("Could not read local Supabase status.");
    process.exit(1);
  }

  const env = {
    SUPABASE_URL: local.API_URL,
    SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? local.ANON_KEY,
    SUPABASE_SECRET_KEY: local.SECRET_KEY ?? local.SERVICE_ROLE_KEY,
    STORAGE_BUCKET: "payslip-sources",
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) {
    console.error("Local Supabase status is missing required service values.");
    process.exit(1);
  }

  return { label: "LOCAL Docker stack", env };
}

/** The hosted project, read from .env. The only place ES256 verification is exercised. */
function resolveHostedTarget() {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "STORAGE_BUCKET",
  ];
  const env = {};
  const missing = [];

  for (const name of names) {
    const value = process.env[name];
    if (!value) missing.push(name);
    else env[name] = value;
  }

  if (missing.length > 0) {
    console.error(
      `Missing ${missing.join(", ")} in .env. These tests run against the hosted project; ` +
        "use npm run test:integration:local for the Docker stack instead.",
    );
    process.exit(1);
  }

  return { label: "HOSTED project", env };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
