/**
 * Enforces PRD §9.2: no secret reaches the browser bundle. Run after `npm run build`; CI runs it
 * as `npm run check:secrets`.
 *
 * 1. `.env.example`: a `VITE_` name ending in KEY/SECRET/TOKEN/PASSWORD fails unless allow-listed.
 * 2. `.env.example`: names only; any variable outside SAFE carrying a value fails.
 * 3. The bundle (every file under `client/dist`): no file contains a server-secret marker.
 * 4. The bundle, when a `.env` exists (never in CI): no file contains the value of a server-only
 *    secret. A value equal to an allow-listed `VITE_` variable's is public by design and is not
 *    searched for: `SUPABASE_PUBLISHABLE_KEY` is the same key as `VITE_SUPABASE_PUBLISHABLE_KEY`.
 *
 * `--url <client origin>` scans what the deployed client serves instead of `client/dist`: its
 * `index.html`, every `/assets/` file that references, and every one those files reference in turn
 * (the pdf.js worker is loaded from inside the entry chunk). `--env-example` and `--dist` point at
 * scratch copies when proving that a check still bites.
 *
 * Problems name the variable, never its value. Exit 1 lists every problem at once.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, parseEnv } from "node:util";

// Public by design: the successor to the anon key, which Row Level Security assumes the browser
// holds. Anything added here must be equally safe in the hands of any visitor.
const ALLOWED = new Set(["VITE_SUPABASE_PUBLISHABLE_KEY"]);
const SAFE = new Set(["PORT", "NODE_ENV", "LOG_LEVEL", "WEB_ORIGIN"]);
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)$/;
const MARKERS = [
  "SERVICE_ROLE",
  "service_role",
  "SUPABASE_SECRET_KEY",
  "AZURE_CONTENT_UNDERSTANDING_KEY",
  "AZURE_DOCUMENT_INTELLIGENCE_KEY",
  "AZURE_OPENAI_KEY",
  "eyJhbGciOi",
];
const MIN_NEEDLE_LENGTH = 8;

const { values: args } = parseArgs({
  options: {
    "env-example": { type: "string", default: ".env.example" },
    dist: { type: "string", default: "client/dist" },
    url: { type: "string" },
  },
});

function checkEnvExample(text) {
  const problems = [];
  const secretShaped = [];
  const populated = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, name, value] = match;
    if (name.startsWith("VITE_") && !ALLOWED.has(name) && SECRET_NAME.test(name)) {
      secretShaped.push(name);
    }
    if (!SAFE.has(name) && value.trim() !== "") populated.push(name);
  }
  if (secretShaped.length > 0) {
    problems.push(`secret-bearing variable carries a VITE_ prefix: ${secretShaped.join(", ")}`);
  }
  if (populated.length > 0) {
    problems.push(`.env.example must contain names only; populated: ${populated.join(", ")}`);
  }
  return problems;
}

/** The file's text, or undefined for a `404` when `optional`. */
async function fetchText(url, optional = false) {
  const response = await fetch(url);
  if (optional && response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return response.text();
}

/**
 * Asset URLs a file references: `/assets/…` and `assets/…` from the origin, as `index.html` and the
 * worker URL use, and `./…` relative to the file itself, as Vite's lazy `import()` chunks use.
 */
function assetRefs(text, base) {
  const origin = new URL(base).origin;
  const rooted = [...text.matchAll(/\/?assets\/[\w.-]+\.(?:js|mjs|css)/g)].map(
    ([ref]) => new URL(ref.startsWith("/") ? ref : `/${ref}`, origin).href,
  );
  const relative = [...text.matchAll(/["'`](\.\/[\w.-]+\.(?:js|mjs|css))["'`]/g)].map(
    ([, ref]) => new URL(ref, base).href,
  );
  return [...rooted, ...relative];
}

async function collectBundle() {
  if (args.url === undefined) {
    if (!existsSync(join(args.dist, "index.html"))) {
      throw new Error(`${args.dist}/index.html not found: run npm run build first`);
    }
    // Everything Render serves, not only assets/: index.html is where `%VITE_…%` lands.
    return readdirSync(args.dist, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return { name: path, text: readFileSync(path, "utf8") };
      });
  }

  const origin = new URL(args.url).origin;
  const page = await fetchText(`${origin}/`);
  const files = [{ name: "/", text: page }];
  const entries = new Set(assetRefs(page, `${origin}/`));
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    // What index.html names must load. A string found inside a chunk may name a file the build
    // never emitted (pdf.js mentions `./qcms_bg.js`); a 404 serves nothing, so it cannot leak.
    const text = await fetchText(url, !entries.has(url));
    if (text === undefined) {
      console.log(`note: ${new URL(url).pathname} is referenced but not served (404), skipped`);
      continue;
    }
    files.push({ name: new URL(url).pathname, text });
    queue.push(...assetRefs(text, url));
  }
  if (entries.size === 0) throw new Error(`${origin}/ references no /assets/ files`);
  return files;
}

function secretNeedles() {
  if (!existsSync(".env")) {
    console.log("note: no .env here (as in CI), so the real-values check is skipped");
    return undefined;
  }
  const env = parseEnv(readFileSync(".env", "utf8"));
  // Only an allow-listed VITE_ value is public; a secret wrongly given a VITE_ twin stays searched.
  const publicValues = new Set(
    Object.entries(env)
      .filter(([name]) => ALLOWED.has(name))
      .map(([, value]) => value),
  );
  const needles = [];
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("VITE_")) continue;
    if (!SECRET_NAME.test(name) && name !== "DATABASE_URL") continue;
    if (value.length < MIN_NEEDLE_LENGTH) continue;
    if (publicValues.has(value)) {
      console.log(
        `note: ${name} equals an allow-listed VITE_ value, public by design, so it is not searched for`,
      );
      continue;
    }
    needles.push({ name, value });
  }
  return needles;
}

function scanBundle(files, needles) {
  const problems = [];
  for (const { name, text } of files) {
    for (const marker of MARKERS) {
      if (text.includes(marker)) problems.push(`${name} contains the marker ${marker}`);
    }
    for (const needle of needles ?? []) {
      if (text.includes(needle.value))
        problems.push(`${name} contains the value of ${needle.name}`);
    }
  }
  return problems;
}

const problems = checkEnvExample(readFileSync(args["env-example"], "utf8"));
if (problems.length === 0)
  console.log(`ok: ${args["env-example"]} names only, no secret VITE_ name`);

try {
  const files = await collectBundle();
  const needles = secretNeedles();
  const bundleProblems = scanBundle(files, needles);
  problems.push(...bundleProblems);
  if (bundleProblems.length === 0) {
    const values = needles === undefined ? "" : ` and ${needles.length} server secret values`;
    console.log(`ok: ${files.length} bundle files free of ${MARKERS.length} markers${values}`);
  }
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  process.exit(1);
}
