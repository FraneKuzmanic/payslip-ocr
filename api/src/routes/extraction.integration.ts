import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "@cantoo/pdf-lib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createPayslipResponseSchema,
  createSessionResponseSchema,
  payslipDetailResponseSchema,
  sessionDetailResponseSchema,
  type SessionDetailResponse,
} from "@payslip/shared";
import { createApp } from "../app.js";
import { config } from "../config.js";
import type { Database } from "../database.types.js";
import { logger } from "../logger.js";
import {
  COST_ASSUMPTIONS,
  estimateUsageCost,
} from "../providers/document-extraction/content-understanding/usage.js";
import {
  EXTRACTION_PASSES as PASSES,
  type ExtractionPass as Pass,
} from "../providers/document-extraction/types.js";
import { percentiles } from "../scoring/score.js";
import { sourceObjectPath } from "../storage/payslip-sources.js";

/**
 * The golden run (Task 04 D17): every golden-set payslip through the real API, the hosted
 * Supabase project and the real extraction provider. PAID — about $0.40 a two-pass run against
 * limited student credit — so it runs only through `npm run test:extraction`, never
 * `test:integration`.
 *
 * It also records each retained response as `.bakeoff/<GOLDEN_SET>/<sample>.json`, a recording set
 * `npm run score:extraction` measures run-to-run spread against (Task 05 D13):
 *
 * - `GOLDEN_SET` (required) names the set. The run refuses to start if it already exists, so a paid
 *   run can never overwrite a baseline.
 * - `GOLDEN_MODE` is `concurrent` (default: every payslip uploaded at once), `sequential` (one
 *   payslip uploaded and settled before the next, PRD §11.4's "single payslip" condition) or `quads`
 *   (PRD §11.4's "four payslips in parallel", Task 13 D2): three sessions of four, each uploaded
 *   sequentially as the client does and settled before the next. The third quad repeats A01, which
 *   is timed but not recorded.
 * - `GOLDEN_API_URL` (optional, `https://` only) sends every request to that deployed API instead of
 *   the in-process app. It writes to the same Supabase project and bucket.
 * - `GOLDEN_KEEP=1` keeps the account and its data after the run, and prints its email (Task 13 D12).
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = join(ROOT, ".agents", "fixtures", "expected");
const SAMPLES_DIR = join(ROOT, "payslip_examples");
const GOLDEN_MODE = process.env.GOLDEN_MODE ?? "concurrent";
const GOLDEN_SET = process.env.GOLDEN_SET ?? "";
const RECORDING_DIR = join(ROOT, ".bakeoff", GOLDEN_SET);
// A trailing slash would make every request path start with `//`.
const GOLDEN_API_URL = (process.env.GOLDEN_API_URL ?? "").replace(/\/+$/, "");
const GOLDEN_KEEP = process.env.GOLDEN_KEEP === "1";
const MODES = ["concurrent", "sequential", "quads"];

/** One pass's timings, as the runner and provider record them (Task 05 D8). */
interface PassTimings {
  queuedMs: number;
  latencyMs: number;
  uploadMs?: number;
  analyzeMs?: number;
  submitAttempts?: number;
}

// The client's own interval (`SessionPage.tsx`, Task 17 D7).
const POLL_INTERVAL_MS = 500;
const POLL_CAP_MS = 6 * 60 * 1000;
const BLANK = "blank.pdf";
const QUAD_TARGET_MS = 25_000;
const HEALTH_CAP_MS = 90_000;
const HEALTH_RETRY_MS = 5000;

interface Fixture {
  sample: string;
  sourceFile: string;
  pageCount: number;
}

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".json"))
  .toSorted()
  .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Fixture);

const userId = randomUUID();
const email = `task04-${userId}@example.test`;
const password = "Task04-extraction-password-123!";

const supabaseUrl = requiredEnv("SUPABASE_URL");
const admin = createServerClient(requiredEnv("SUPABASE_SECRET_KEY"));
const user = createServerClient(requiredEnv("SUPABASE_PUBLISHABLE_KEY"));

// A paid run must say why anything failed: server faults, provider errors and failed passes are
// printed. `warn`, because a failed pass and a refused provider request are logged there.
logger.level = "warn";

// The real runner and provider: this is the one suite that proves them against the service. With
// `GOLDEN_API_URL`, the deployed API's runner and provider instead.
const target = GOLDEN_API_URL === "" ? createApp() : GOLDEN_API_URL;

const sourcePaths: string[] = [];
let token = "";

beforeAll(async () => {
  if (!MODES.includes(GOLDEN_MODE)) {
    throw new Error(`GOLDEN_MODE must be one of ${MODES.join(", ")}, not '${GOLDEN_MODE}'.`);
  }
  if (GOLDEN_API_URL !== "" && !GOLDEN_API_URL.startsWith("https://")) {
    throw new Error(`GOLDEN_API_URL must be an https:// origin, not '${GOLDEN_API_URL}'.`);
  }
  if (!/^[a-z0-9-]+$/.test(GOLDEN_SET)) {
    throw new Error("GOLDEN_SET is required: the .bakeoff/<name>/ directory to record into.");
  }
  // Before any upload or paid call: a recorded baseline is never overwritten.
  if (existsSync(RECORDING_DIR)) {
    throw new Error(`.bakeoff/${GOLDEN_SET}/ already exists; choose a new GOLDEN_SET.`);
  }
  const missing = fixtures
    .map((fixture) => fixture.sourceFile)
    .filter((file) => !existsSync(join(SAMPLES_DIR, file)));
  if (missing.length > 0) {
    throw new Error(
      `payslip_examples/ is missing ${missing.join(", ")}; the golden run needs all 11.`,
    );
  }
  if (GOLDEN_MODE === "quads" && fixtures.length !== 11) {
    throw new Error(`quads mode groups the 11 golden samples, not ${fixtures.length}.`);
  }
  if (GOLDEN_API_URL !== "") await awaitHealthy();
  token = await createAndSignIn();
}, HEALTH_CAP_MS + 60_000);

afterAll(async () => {
  if (GOLDEN_KEEP) {
    report(`\n  kept account ${email}; password: see extraction.integration.ts\n`);
    return;
  }
  // Unconditional, including after a failed assertion. Rows cascade from the user.
  if (sourcePaths.length > 0) await admin.storage.from(config.STORAGE_BUCKET).remove(sourcePaths);
  await admin.auth.admin.deleteUser(userId);
});

describe("extraction against the real service", () => {
  it(
    "extracts every golden-set payslip, and fails a blank page without touching its sibling",
    async () => {
      report(
        `\n  golden run: mode ${GOLDEN_MODE}, recording to .bakeoff/${GOLDEN_SET}/, against ` +
          `${GOLDEN_API_URL === "" ? "the in-process app" : GOLDEN_API_URL}\n`,
      );
      const first = fixtures.slice(0, 10);
      const rest = fixtures.slice(10);
      const blank = await blankPdf();

      const ids = new Map<string, string>();
      const quadRuns: QuadRun[] = [];
      let repeatId = "";
      let blankId: string;
      let settled: SessionDetailResponse["payslips"];
      if (GOLDEN_MODE === "quads") {
        // By sorted index: A01–A04, B01–D01, then E01, F01, G01 and A01 again, the heaviest.
        const quads = [
          [0, 1, 2, 3],
          [4, 5, 6, 7],
          [8, 9, 10, 0],
        ].map((indexes) => indexes.map((index) => fixtures[index] as Fixture));
        settled = [];
        for (const [index, quad] of quads.entries()) {
          const sessionId = await createSession();
          const startedAt = Date.now();
          for (const fixture of quad) {
            const id = await uploadFixture(sessionId, fixture);
            // The repeat keeps the recording set at one file per sample.
            if (ids.has(fixture.sample)) repeatId = id;
            else ids.set(fixture.sample, id);
          }
          const uploadedMs = Date.now() - startedAt;
          settled.push(...(await settle(sessionId)).payslips);
          quadRuns.push({
            quad: index + 1,
            samples: quad.map((fixture) => fixture.sample),
            uploadedMs,
            wallMs: Date.now() - startedAt,
          });
        }
        const blankSession = await createSession();
        blankId = await upload(blankSession, blank, BLANK, "application/pdf");
        settled.push(...(await settle(blankSession)).payslips);
      } else if (GOLDEN_MODE === "sequential") {
        const sessionOne = await createSession();
        const sessionTwo = await createSession();
        // One payslip in flight at a time; the blank goes last, in its own session.
        for (const fixture of first) {
          ids.set(fixture.sample, await uploadFixture(sessionOne, fixture));
          await settle(sessionOne);
        }
        for (const fixture of rest) {
          ids.set(fixture.sample, await uploadFixture(sessionTwo, fixture));
          await settle(sessionTwo);
        }
        const sessionThree = await createSession();
        blankId = await upload(sessionThree, blank, BLANK, "application/pdf");
        settled = [
          ...(await settle(sessionOne)).payslips,
          ...(await settle(sessionTwo)).payslips,
          ...(await settle(sessionThree)).payslips,
        ];
      } else {
        const sessionOne = await createSession();
        const sessionTwo = await createSession();
        for (const fixture of first)
          ids.set(fixture.sample, await uploadFixture(sessionOne, fixture));
        for (const fixture of rest)
          ids.set(fixture.sample, await uploadFixture(sessionTwo, fixture));
        blankId = await upload(sessionTwo, blank, BLANK, "application/pdf");
        settled = [...(await settle(sessionOne)).payslips, ...(await settle(sessionTwo)).payslips];
      }
      const byId = new Map(settled.map((payslip) => [payslip.id, payslip]));

      for (const fixture of fixtures) {
        // The whole summary, so a failure shows its `failureReason`.
        expect(byId.get(ids.get(fixture.sample) ?? ""), fixture.sample).toMatchObject({
          status: "review",
          tablesStatus: "ready",
        });
      }
      if (GOLDEN_MODE === "quads") {
        expect(byId.get(repeatId), "A01#2").toMatchObject({
          status: "review",
          tablesStatus: "ready",
        });
      }
      // Its scalars pass is unreadable; its tables pass was cancelled or unreadable too.
      expect(byId.get(blankId)).toMatchObject({
        status: "failed",
        tablesStatus: "failed",
        failureReason: "unreadable_document",
      });

      const responses: unknown[] = [];
      const firstForm: number[] = [];
      const complete: number[] = [];
      let duplicateRisk = 0;
      mkdirSync(RECORDING_DIR, { recursive: true });
      for (const fixture of fixtures) {
        const id = ids.get(fixture.sample) ?? "";
        const detail = await request(target)
          .get(`/api/payslips/${id}`)
          .set("Authorization", `Bearer ${token}`);
        expect(detail.status).toBe(200);
        const parsed = payslipDetailResponseSchema.parse(detail.body);
        expect(parsed.pageCount, fixture.sample).toBe(fixture.pageCount);
        expect(Array.isArray(parsed.unreadableFields)).toBe(true);

        const { raw, timings } = await readRetained(id, fixture.sample);
        responses.push(raw.scalars, raw.tables);
        for (const pass of PASSES) if ((timings[pass].submitAttempts ?? 1) > 1) duplicateRisk++;

        writeFileSync(
          join(RECORDING_DIR, `${fixture.sample}.json`),
          JSON.stringify({ timings, scalars: raw.scalars, tables: raw.tables }, null, 2),
          "utf8",
        );

        firstForm.push(done(timings, "scalars"));
        complete.push(completeMs(timings));
        report(timingLine(fixture.sample, timings));
      }
      if (GOLDEN_MODE === "quads") {
        // Timed and costed with the others, but not recorded.
        const { raw, timings } = await readRetained(repeatId, "A01#2");
        responses.push(raw.scalars, raw.tables);
        for (const pass of PASSES) if ((timings[pass].submitAttempts ?? 1) > 1) duplicateRisk++;
        firstForm.push(done(timings, "scalars"));
        complete.push(completeMs(timings));
        report(timingLine("A01#2", timings));
      }

      const summary = (values: number[]) => {
        const p = percentiles(values);
        return p === null ? "?" : `p50 ${secs(p.p50)}  p90 ${secs(p.p90)}  max ${secs(p.max)}`;
      };
      report(`\n  FIRST FORM  ${summary(firstForm)}\n  COMPLETE    ${summary(complete)}`);
      if (GOLDEN_MODE === "quads") {
        report(
          "\n  FOUR IN PARALLEL (PRD §11.4, ≤ 25 s): client wall clock from the first upload " +
            `request to the settled session, polled every ${secs(POLL_INTERVAL_MS)}. It includes ` +
            "the four uploads over this machine's uplink. Each payslip is three analyses in two " +
            "passes, and the concurrency cap counts passes (Task 17 D6).",
        );
        for (const run of quadRuns) {
          report(
            `  quad ${run.quad} (${run.samples.join(", ")})  wall ${secs(run.wallMs)}  ` +
              `${run.wallMs <= QUAD_TARGET_MS ? "within" : "over"}  (uploads ${secs(run.uploadedMs)})`,
          );
        }
      }

      const cost = estimateUsageCost(responses);
      report(
        `\n  estimated run cost $${cost.usd.toFixed(2)} (${cost.pages} pages, ` +
          `${cost.uncachedInputTokens} uncached + ${cost.cachedInputTokens} cached input, ` +
          `${cost.outputTokens} output tokens; ${COST_ASSUMPTIONS}). ` +
          `${duplicateRisk} pass(es) resubmitted, each possibly billing a duplicate analysis; ` +
          "the blank page's analyses are not included.\n",
      );
    },
    (GOLDEN_MODE === "concurrent" ? 10 : 20) * 60 * 1000,
  );
});

/** Written past Vitest's console capture, which drops a passing test's output. */
function report(line: string): void {
  process.stdout.write(`${line}
`);
}

interface QuadRun {
  quad: number;
  samples: string[];
  uploadedMs: number;
  wallMs: number;
}

/** The retained response and per-pass timings, read with the admin key. */
async function readRetained(
  id: string,
  label: string,
): Promise<{ raw: Record<Pass, unknown>; timings: Record<Pass, PassTimings> }> {
  const { data, error } = await admin
    .from("payslips")
    .select("raw_provider_result, extraction_metadata")
    .eq("id", id)
    .single();
  if (error) throw new Error(`Could not read the retained response for ${label}.`);
  // Per pass since Task 05 D7.
  const metadata = data.extraction_metadata as unknown as Record<Pass, PassTimings>;
  // The timings travel with the recording, so a later latency investigation can split queue,
  // submit and analysis without re-running a paid extraction.
  const timings = Object.fromEntries(
    PASSES.map((pass) => {
      const { queuedMs, latencyMs, uploadMs, analyzeMs, submitAttempts } = metadata[pass];
      return [pass, { queuedMs, latencyMs, uploadMs, analyzeMs, submitAttempts }];
    }),
  ) as Record<Pass, PassTimings>;
  return { raw: data.raw_provider_result as Record<Pass, unknown>, timings };
}

function done(timings: Record<Pass, PassTimings>, pass: Pass): number {
  return timings[pass].queuedMs + timings[pass].latencyMs;
}

function completeMs(timings: Record<Pass, PassTimings>): number {
  return Math.max(done(timings, "scalars"), done(timings, "tables"));
}

function timingLine(label: string, timings: Record<Pass, PassTimings>): string {
  const detailOf = (pass: Pass) =>
    `${pass} queued ${secs(timings[pass].queuedMs)} submit ${secs(timings[pass].uploadMs)} ` +
    `analysis ${secs(timings[pass].analyzeMs)} attempts ${timings[pass].submitAttempts ?? "?"}`;
  return (
    `  ${label}  first form ${secs(done(timings, "scalars"))}  complete ` +
    `${secs(completeMs(timings))}  (${detailOf("scalars")}; ${detailOf("tables")})`
  );
}

/** A cold start is allowed to finish: `/api/health` must answer 200 within 90 s. */
async function awaitHealthy(): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + HEALTH_CAP_MS;
  for (;;) {
    const response = await fetch(`${GOLDEN_API_URL}/api/health`, {
      signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
    }).catch(() => undefined);
    if (response?.status === 200) {
      const { uptimeSeconds } = (await response.json()) as { uptimeSeconds?: number };
      report(
        `\n  deployed API healthy after ${secs(Date.now() - startedAt)}, uptime ${uptimeSeconds}s`,
      );
      return;
    }
    if (Date.now() + HEALTH_RETRY_MS > deadline) {
      throw new Error(
        `${GOLDEN_API_URL}/api/health did not answer 200 within ${secs(HEALTH_CAP_MS)}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_MS));
  }
}

function secs(ms: number | undefined): string {
  return ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`;
}

async function createSession(): Promise<string> {
  const response = await request(target)
    .post("/api/sessions")
    .set("Authorization", `Bearer ${token}`);
  expect(response.status).toBe(201);
  return createSessionResponseSchema.parse(response.body).id;
}

async function uploadFixture(sessionId: string, fixture: Fixture): Promise<string> {
  const bytes = readFileSync(join(SAMPLES_DIR, fixture.sourceFile));
  return upload(sessionId, bytes, fixture.sourceFile, contentTypeOf(fixture.sourceFile));
}

async function upload(
  sessionId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const response = await request(target)
    .post(`/api/sessions/${sessionId}/payslips`)
    .set("Authorization", `Bearer ${token}`)
    .attach("file", bytes, { filename, contentType });
  expect(response.status, filename).toBe(201);
  const { id } = createPayslipResponseSchema.parse(response.body);
  sourcePaths.push(sourceObjectPath(userId, id));
  return id;
}

/** Polls the session until every payslip has settled: neither pass is still outstanding. */
async function settle(sessionId: string): Promise<SessionDetailResponse> {
  const deadline = Date.now() + POLL_CAP_MS;
  for (;;) {
    const response = await request(target)
      .get(`/api/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    const session = sessionDetailResponseSchema.parse(response.body);
    const settled = session.payslips.every(
      (payslip) => payslip.status !== "processing" && payslip.tablesStatus !== "pending",
    );
    if (settled) return session;
    if (Date.now() > deadline)
      throw new Error(`Session ${sessionId} still extracting after 6 min.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function blankPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([595.28, 841.89]); // A4
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function contentTypeOf(file: string): string {
  const extension = file.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  return "image/jpeg";
}

async function createAndSignIn(): Promise<string> {
  // `email_confirm: true` sends no email, so these runs never touch the project's email quota.
  const { error: createError } = await admin.auth.admin.createUser({
    id: userId,
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`Could not create integration user ${email}.`);

  const { data, error } = await user.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Could not sign in integration user ${email}.`);
  return data.session.access_token;
}

function createServerClient(key: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the extraction golden run.`);
  return value;
}
