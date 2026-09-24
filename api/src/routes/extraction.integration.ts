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
import { sourceObjectPath } from "../storage/payslip-sources.js";

/**
 * The golden run (Task 04 D17): every golden-set payslip through the real API, the hosted
 * Supabase project and the real extraction provider. PAID — about $0.30 a run against limited
 * student credit — so it runs only through `npm run test:extraction`, never `test:integration`.
 *
 * It also records each retained response as `.bakeoff/production/<sample>.json`, the second
 * recording set `npm run score:extraction` measures run-to-run spread against.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = join(ROOT, ".agents", "fixtures", "expected");
const SAMPLES_DIR = join(ROOT, "payslip_examples");
const RECORDING_DIR = join(ROOT, ".bakeoff", "production");

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

// A paid run must say why anything failed: server faults and provider errors are printed.
logger.level = "error";

// The real runner and provider: this is the one suite that proves them against the service.
const app = createApp();

const sourcePaths: string[] = [];
let token = "";

beforeAll(async () => {
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
      const first = fixtures.slice(0, 10);
      const rest = fixtures.slice(10);
      const blank = await blankPdf();

      const sessionOne = await createSession();
      const sessionTwo = await createSession();
      const ids = new Map<string, string>();
      for (const fixture of first)
        ids.set(fixture.sample, await uploadFixture(sessionOne, fixture));
      for (const fixture of rest) ids.set(fixture.sample, await uploadFixture(sessionTwo, fixture));
      const blankId = await upload(sessionTwo, blank, BLANK, "application/pdf");

      const settled = [
        ...(await settle(sessionOne)).payslips,
        ...(await settle(sessionTwo)).payslips,
      ];
      const byId = new Map(settled.map((payslip) => [payslip.id, payslip]));

      for (const fixture of fixtures) {
        // The whole summary, so a failure shows its `failureReason`.
        expect(byId.get(ids.get(fixture.sample) ?? ""), fixture.sample).toMatchObject({
          status: "review",
        });
      }
      expect(byId.get(blankId)).toMatchObject({
        status: "failed",
        failureReason: "unreadable_document",
      });

      const responses: unknown[] = [];
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
        const metadata = data.extraction_metadata as {
          latencyMs: number;
          uploadMs?: number;
          analyzeMs?: number;
          submitAttempts?: number;
        };
        responses.push(data.raw_provider_result);
        if ((metadata.submitAttempts ?? 1) > 1) duplicateRisk++;
        // The timings travel with the recording, so a later latency investigation (Task 05) can
        // split submit from analysis without re-running a paid extraction.
        const { latencyMs, uploadMs, analyzeMs, submitAttempts } = metadata;
        writeFileSync(
          join(RECORDING_DIR, `${fixture.sample}.json`),
          JSON.stringify(
            {
              latencyMs,
              uploadMs,
              analyzeMs,
              submitAttempts,
              ...(data.raw_provider_result as object),
            },
            null,
            2,
          ),
          "utf8",
        );
        report(
          `  ${fixture.sample}  ${secs(latencyMs)}  (submit ${secs(uploadMs)}, ` +
            `analysis ${secs(analyzeMs)}, submit attempts ${submitAttempts ?? "?"})`,
        );
      }

      const cost = estimateUsageCost(responses);
      report(
        `\n  estimated run cost $${cost.usd.toFixed(2)} (${cost.pages} pages, ` +
          `${cost.uncachedInputTokens} uncached + ${cost.cachedInputTokens} cached input, ` +
          `${cost.outputTokens} output tokens; ${COST_ASSUMPTIONS}). ` +
          `${duplicateRisk} payslip(s) resubmitted, each possibly billing a duplicate analysis; ` +
          "the blank page's analysis is not included.\n",
      );
    },
    10 * 60 * 1000,
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

/** Polls the session until no payslip is still `processing`. */
async function settle(sessionId: string): Promise<SessionDetailResponse> {
  const deadline = Date.now() + POLL_CAP_MS;
  for (;;) {
    const response = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    const session = sessionDetailResponseSchema.parse(response.body);
    if (session.payslips.every((payslip) => payslip.status !== "processing")) return session;
    if (Date.now() > deadline)
      throw new Error(`Session ${sessionId} still processing after 6 min.`);
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
