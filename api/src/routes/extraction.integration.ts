import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
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
 * - `GOLDEN_MODE` is `concurrent` (default: every payslip uploaded at once) or `sequential` (one
 *   payslip uploaded and settled before the next, PRD §11.4's "single payslip" condition).
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = join(ROOT, ".agents", "fixtures", "expected");
const SAMPLES_DIR = join(ROOT, "payslip_examples");
const GOLDEN_MODE = process.env.GOLDEN_MODE ?? "concurrent";
const GOLDEN_SET = process.env.GOLDEN_SET ?? "";
const RECORDING_DIR = join(ROOT, ".bakeoff", GOLDEN_SET);

/** One pass's timings, as the runner and provider record them (Task 05 D8). */
interface PassTimings {
  queuedMs: number;
  latencyMs: number;
  uploadMs?: number;
  analyzeMs?: number;
  submitAttempts?: number;
}

const POLL_INTERVAL_MS = 2000;
const POLL_CAP_MS = 6 * 60 * 1000;
const BLANK = "blank.pdf";

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

// The real runner and provider: this is the one suite that proves them against the service.
const app = createApp();

const sourcePaths: string[] = [];
let token = "";

beforeAll(async () => {
  if (GOLDEN_MODE !== "sequential" && GOLDEN_MODE !== "concurrent") {
    throw new Error(`GOLDEN_MODE must be 'sequential' or 'concurrent', not '${GOLDEN_MODE}'.`);
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
  token = await createAndSignIn();
});

afterAll(async () => {
  // Unconditional, including after a failed assertion. Rows cascade from the user.
  if (sourcePaths.length > 0) await admin.storage.from(config.STORAGE_BUCKET).remove(sourcePaths);
  await admin.auth.admin.deleteUser(userId);
});

describe("extraction against the real service", () => {
  it(
    "extracts every golden-set payslip, and fails a blank page without touching its sibling",
    async () => {
      report(`\n  golden run: mode ${GOLDEN_MODE}, recording to .bakeoff/${GOLDEN_SET}/\n`);
      const first = fixtures.slice(0, 10);
      const rest = fixtures.slice(10);
      const blank = await blankPdf();

      const sessionOne = await createSession();
      const sessionTwo = await createSession();
      const ids = new Map<string, string>();
      let blankId: string;
      let settled: SessionDetailResponse["payslips"];
      if (GOLDEN_MODE === "sequential") {
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
        const detail = await request(app)
          .get(`/api/payslips/${id}`)
          .set("Authorization", `Bearer ${token}`);
        expect(detail.status).toBe(200);
        const parsed = payslipDetailResponseSchema.parse(detail.body);
        expect(parsed.pageCount, fixture.sample).toBe(fixture.pageCount);
        expect(Array.isArray(parsed.unreadableFields)).toBe(true);

        const { data, error } = await admin
          .from("payslips")
          .select("raw_provider_result, extraction_metadata")
          .eq("id", id)
          .single();
        if (error) throw new Error(`Could not read the retained response for ${fixture.sample}.`);
        // Per pass since Task 05 D7.
        const metadata = data.extraction_metadata as unknown as Record<Pass, PassTimings>;
        const raw = data.raw_provider_result as Record<Pass, unknown>;
        responses.push(raw.scalars, raw.tables);
        for (const pass of PASSES) if ((metadata[pass].submitAttempts ?? 1) > 1) duplicateRisk++;

        // The timings travel with the recording, so a later latency investigation can split
        // queue, submit and analysis without re-running a paid extraction.
        const timings = Object.fromEntries(
          PASSES.map((pass) => {
            const { queuedMs, latencyMs, uploadMs, analyzeMs, submitAttempts } = metadata[pass];
            return [pass, { queuedMs, latencyMs, uploadMs, analyzeMs, submitAttempts }];
          }),
        ) as Record<Pass, PassTimings>;
        writeFileSync(
          join(RECORDING_DIR, `${fixture.sample}.json`),
          JSON.stringify({ timings, scalars: raw.scalars, tables: raw.tables }, null, 2),
          "utf8",
        );

        const done = (pass: Pass) => timings[pass].queuedMs + timings[pass].latencyMs;
        firstForm.push(done("scalars"));
        complete.push(Math.max(done("scalars"), done("tables")));
        const detailOf = (pass: Pass) =>
          `${pass} queued ${secs(timings[pass].queuedMs)} submit ${secs(timings[pass].uploadMs)} ` +
          `analysis ${secs(timings[pass].analyzeMs)} attempts ${timings[pass].submitAttempts ?? "?"}`;
        report(
          `  ${fixture.sample}  first form ${secs(done("scalars"))}  complete ` +
            `${secs(Math.max(done("scalars"), done("tables")))}  (${detailOf("scalars")}; ` +
            `${detailOf("tables")})`,
        );
      }

      const summary = (values: number[]) => {
        const p = percentiles(values);
        return p === null ? "?" : `p50 ${secs(p.p50)}  p90 ${secs(p.p90)}  max ${secs(p.max)}`;
      };
      report(`\n  FIRST FORM  ${summary(firstForm)}\n  COMPLETE    ${summary(complete)}`);

      const cost = estimateUsageCost(responses);
      report(
        `\n  estimated run cost $${cost.usd.toFixed(2)} (${cost.pages} pages, ` +
          `${cost.uncachedInputTokens} uncached + ${cost.cachedInputTokens} cached input, ` +
          `${cost.outputTokens} output tokens; ${COST_ASSUMPTIONS}). ` +
          `${duplicateRisk} pass(es) resubmitted, each possibly billing a duplicate analysis; ` +
          "the blank page's analyses are not included.\n",
      );
    },
    (GOLDEN_MODE === "sequential" ? 20 : 10) * 60 * 1000,
  );
});

/** Written past Vitest's console capture, which drops a passing test's output. */
function report(line: string): void {
  process.stdout.write(`${line}
`);
}

function secs(ms: number | undefined): string {
  return ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`;
}

async function createSession(): Promise<string> {
  const response = await request(app).post("/api/sessions").set("Authorization", `Bearer ${token}`);
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
  const response = await request(app)
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
    const response = await request(app)
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
