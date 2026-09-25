import { randomBytes, randomUUID } from "node:crypto";
import { PDFDocument, PDFHexString } from "pdf-lib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_PAYSLIPS_PER_SESSION,
  createPayslipResponseSchema,
  createSessionResponseSchema,
  listPayslipsResponseSchema,
  payslipDetailResponseSchema,
  retryPayslipResponseSchema,
  sessionDetailResponseSchema,
  sourceDocumentResponseSchema,
  sourceRegionsResponseSchema,
} from "@payslip/shared";
import { createApp } from "../app.js";
import { config } from "../config.js";
import type { Database } from "../database.types.js";
import {
  regionsPassBody,
  rows,
  sourced,
} from "../providers/document-extraction/content-understanding/regions.fixture.js";
import { PayslipRepository } from "../repositories/payslips.js";
import type { ExtractionJob } from "../services/payslip-extraction.js";
import { SOURCE_URL_TTL_SECONDS, sourceObjectPath } from "../storage/payslip-sources.js";

const userAId = randomUUID();
const userBId = randomUUID();
const password = "Task03-integration-password-123!";

// A greppable, per-run prefix: these users live in the real hosted project, so an orphan left by
// a crashed run has to be findable. Never a fixed id or address.
const userAEmail = `task03-a-${userAId}@example.test`;
const userBEmail = `task03-b-${userBId}@example.test`;

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const supabaseUrl = requiredEnv("SUPABASE_URL");
const admin = createServerClient(requiredEnv("SUPABASE_SECRET_KEY"));
const userA = createServerClient(requiredEnv("SUPABASE_PUBLISHABLE_KEY"));
const userB = createServerClient(requiredEnv("SUPABASE_PUBLISHABLE_KEY"));

// The real authenticator, against real ES256 tokens. Stubbing it here would prove nothing.
// Extraction is a no-op: this suite asserts `processing` and must never call the provider, which
// `npm run test:extraction` exercises instead.
const app = createApp({ extraction: { enqueue: () => Promise.resolve() } });

// Pushed immediately after each 201, so a failed assertion still cleans up.
const sourcePaths: string[] = [];

let tokenA = "";
let tokenB = "";
let sessionId = "";
let jpegPayslipId = "";
let pdfPayslipId = "";
let pdfBytes: Buffer = Buffer.alloc(0);
let fullSessionId = "";
let fullSessionPayslipIds: string[] = [];

beforeAll(async () => {
  tokenA = await createAndSignIn(userA, userAId, userAEmail);
  tokenB = await createAndSignIn(userB, userBId, userBEmail);
});

afterAll(async () => {
  // Unconditional, including after a failed assertion. Rows cascade from the users.
  if (sourcePaths.length > 0) await admin.storage.from(config.STORAGE_BUCKET).remove(sourcePaths);
  await admin.auth.admin.deleteUser(userAId);
  await admin.auth.admin.deleteUser(userBId);
});

describe("sessions and payslips against the hosted project", () => {
  it("creates a session", async () => {
    const response = await request(app)
      .post("/api/sessions")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(201);
    sessionId = createSessionResponseSchema.parse(response.body).id;
  });

  it("uploads a JPEG and a two-page PDF, preserving their exact bytes", async () => {
    const jpegResponse = await upload(tokenA, sessionId, jpeg, "payslip.jpg", "image/jpeg");
    expect(jpegResponse.status).toBe(201);
    const jpegCreated = createPayslipResponseSchema.parse(jpegResponse.body);
    jpegPayslipId = jpegCreated.id;
    sourcePaths.push(sourceObjectPath(userAId, jpegPayslipId));
    expect(jpegCreated).toMatchObject({ sessionId, status: "processing" });

    pdfBytes = await pdf(2);
    const pdfResponse = await upload(
      tokenA,
      sessionId,
      pdfBytes,
      "platna-lista-ožujak.pdf",
      "application/pdf",
    );
    expect(pdfResponse.status).toBe(201);
    pdfPayslipId = createPayslipResponseSchema.parse(pdfResponse.body).id;
    sourcePaths.push(sourceObjectPath(userAId, pdfPayslipId));

    expect(await downloadAsA(jpegPayslipId)).toEqual(jpeg);
    expect(await downloadAsA(pdfPayslipId)).toEqual(pdfBytes);

    const jpegDetail = await getAsA(`/api/payslips/${jpegPayslipId}`);
    const pdfDetail = await getAsA(`/api/payslips/${pdfPayslipId}`);
    expect(payslipDetailResponseSchema.parse(jpegDetail.body)).toMatchObject({
      pageCount: 1,
      currency: "EUR",
      status: "processing",
      warnings: [],
      lowConfidenceFields: [],
      unreadableFields: [],
      ungroundableFields: [],
      editedFields: [],
      failureReason: null,
    });
    expect(payslipDetailResponseSchema.parse(pdfDetail.body).pageCount).toBe(2);
  });

  it("reads the session with its payslips in upload order", async () => {
    const response = await getAsA(`/api/sessions/${sessionId}`);

    expect(response.status).toBe(200);
    const detail = sessionDetailResponseSchema.parse(response.body);
    expect(detail.id).toBe(sessionId);
    expect(detail.payslips.map((payslip) => payslip.id)).toEqual([jpegPayslipId, pdfPayslipId]);
    expect(detail.payslips[0]).toEqual({
      id: jpegPayslipId,
      status: "processing",
      tablesStatus: "pending",
      period: null,
      employeeName: null,
      pageCount: 1,
      failureReason: null,
      warningCount: 0,
      originalFilename: "payslip.jpg",
    });
  });

  it("admits exactly the cap from concurrent uploads and leaves no orphan source", async () => {
    const created = await request(app)
      .post("/api/sessions")
      .set("Authorization", `Bearer ${tokenA}`);
    fullSessionId = createSessionResponseSchema.parse(created.body).id;

    const responses = await Promise.all(
      Array.from({ length: MAX_PAYSLIPS_PER_SESSION + 1 }, (_, index) =>
        upload(tokenA, fullSessionId, jpeg, `payslip-${index}.jpg`, "image/jpeg"),
      ),
    );
    const accepted = responses.filter((response) => response.status === 201);
    fullSessionPayslipIds = accepted.map(
      (response) => createPayslipResponseSchema.parse(response.body).id,
    );
    sourcePaths.push(...fullSessionPayslipIds.map((id) => sourceObjectPath(userAId, id)));

    expect(accepted).toHaveLength(MAX_PAYSLIPS_PER_SESSION);
    const rejected = responses.filter((response) => response.status !== 201);
    expect(rejected.map((response) => [response.status, response.body])).toEqual([
      [409, { error: { code: "session_full" } }],
    ]);

    const detail = sessionDetailResponseSchema.parse(
      (await getAsA(`/api/sessions/${fullSessionId}`)).body,
    );
    expect(detail.payslips).toHaveLength(MAX_PAYSLIPS_PER_SESSION);

    // Every source folder in A's prefix belongs to a live payslip, so the refused upload's
    // object was removed. Nothing has been deleted yet, so every payslip so far is live.
    const { data: folders, error } = await admin.storage
      .from(config.STORAGE_BUCKET)
      .list(userAId, { limit: 1000 });
    expect(error).toBeNull();
    const live = new Set([jpegPayslipId, pdfPayslipId, ...fullSessionPayslipIds]);
    expect(folders?.map((folder) => folder.name).toSorted()).toEqual([...live].toSorted());
  });

  it("does not count a soft-deleted payslip toward the cap", async () => {
    const deleted = await request(app)
      .delete(`/api/payslips/${fullSessionPayslipIds[0]}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(deleted.status).toBe(204);

    const response = await upload(tokenA, fullSessionId, jpeg, "replacement.jpg", "image/jpeg");
    expect(response.status).toBe(201);
    sourcePaths.push(
      sourceObjectPath(userAId, createPayslipResponseSchema.parse(response.body).id),
    );
  });

  // The API never writes these columns, but the user's own grant does, straight to PostgREST.
  it.each([
    ["restoring a soft-deleted payslip", () => fullSessionPayslipIds[0]!, { deleted_at: null }],
    ["moving a live payslip in", () => pdfPayslipId, () => ({ session_id: fullSessionId })],
  ] as const)("refuses %s into a full session by a direct write", async (_name, id, change) => {
    const { error } = await userA
      .from("payslips")
      .update(typeof change === "function" ? change() : change)
      .eq("id", id());

    expect(error?.message).toBe("session_full");
    const detail = sessionDetailResponseSchema.parse(
      (await getAsA(`/api/sessions/${fullSessionId}`)).body,
    );
    expect(detail.payslips).toHaveLength(MAX_PAYSLIPS_PER_SESSION);
  });

  it.each([
    ["an encrypted PDF", encryptedPdf, "payslip.pdf", 422, "pdf_encrypted"],
    [
      "a PDF over the page limit",
      () => pdf(config.MAX_PDF_PAGES + 1),
      "payslip.pdf",
      422,
      "pdf_too_many_pages",
    ],
    [
      "text renamed to .pdf",
      () => Promise.resolve(Buffer.from("plain text")),
      "payslip.pdf",
      415,
      "unsupported_media_type",
    ],
  ] as const)("rejects %s without creating a row", async (_name, bytes, filename, status, code) => {
    const response = await upload(tokenA, sessionId, await bytes(), filename, "application/pdf");

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: { code } });
    const detail = sessionDetailResponseSchema.parse(
      (await getAsA(`/api/sessions/${sessionId}`)).body,
    );
    expect(detail.payslips).toHaveLength(2);
  });

  it("lists only the caller's live payslips, with paging and a status filter", async () => {
    const first = listPayslipsResponseSchema.parse((await getAsA("/api/payslips?limit=2")).body);
    // 2 in the first session, plus 10 then 1 replacement in the full one, minus 1 deleted.
    const liveCount = 2 + MAX_PAYSLIPS_PER_SESSION;
    expect(first).toMatchObject({ page: 1, limit: 2, total: liveCount });
    expect(first.items).toHaveLength(2);

    const review = listPayslipsResponseSchema.parse(
      (await getAsA("/api/payslips?status=review")).body,
    );
    expect(review.total).toBe(0);

    const beyond = listPayslipsResponseSchema.parse((await getAsA("/api/payslips?page=999")).body);
    expect(beyond).toMatchObject({ items: [], total: liveCount });
  });

  it("signs a source URL with the documented TTL that serves the exact bytes", async () => {
    const response = await getAsA(`/api/payslips/${pdfPayslipId}/source`);

    expect(response.status).toBe(200);
    const source = sourceDocumentResponseSchema.parse(response.body);
    expect(source).toMatchObject({
      contentType: "application/pdf",
      originalFilename: "platna-lista-ožujak.pdf",
    });
    const expected = Date.now() + SOURCE_URL_TTL_SECONDS * 1000;
    expect(Math.abs(Date.parse(source.expiresAt) - expected)).toBeLessThan(10_000);

    const served = await fetch(source.url);
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer())).toEqual(pdfBytes);
  });
});

describe("another user", () => {
  it("receives 404 on every session and payslip endpoint, never 403", async () => {
    const attempts = [
      request(app).get(`/api/sessions/${sessionId}`),
      request(app)
        .post(`/api/sessions/${sessionId}/payslips`)
        .attach("file", jpeg, { filename: "payslip.jpg", contentType: "image/jpeg" }),
      request(app).get(`/api/payslips/${jpegPayslipId}`),
      request(app).get(`/api/payslips/${jpegPayslipId}/source`),
      request(app).get(`/api/payslips/${jpegPayslipId}/regions`),
      request(app).delete(`/api/payslips/${jpegPayslipId}`),
      request(app).post(`/api/payslips/${jpegPayslipId}/retry`),
    ];

    for (const attempt of attempts) {
      const response = await attempt.set("Authorization", `Bearer ${tokenB}`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: "not_found" } });
    }

    const list = listPayslipsResponseSchema.parse(
      (await request(app).get("/api/payslips").set("Authorization", `Bearer ${tokenB}`)).body,
    );
    expect(list.total).toBe(0);

    const detail = sessionDetailResponseSchema.parse(
      (await getAsA(`/api/sessions/${sessionId}`)).body,
    );
    expect(detail.payslips.map((payslip) => payslip.id)).toEqual([jpegPayslipId, pdfPayslipId]);
  });

  it("cannot update the first user's payslip through the repository", async () => {
    const updated = await new PayslipRepository(userB, userBId).update(jpegPayslipId, {
      deletedAt: new Date().toISOString(),
    });

    expect(updated).toBeNull();
    expect((await getAsA(`/api/payslips/${jpegPayslipId}`)).status).toBe(200);
  });

  it("cannot attach a row to the first user's session by writing to the table directly", async () => {
    const { error } = await userB.from("payslips").insert({
      session_id: sessionId,
      user_id: userBId,
      original_filename: "intruder.jpg",
      content_type: "image/jpeg",
      page_count: 1,
    });

    expect(error?.code).toBe("42501");
    const detail = sessionDetailResponseSchema.parse(
      (await getAsA(`/api/sessions/${sessionId}`)).body,
    );
    expect(detail.payslips).toHaveLength(2);
  });
});

describe("extraction passes (Task 05 D7, D10)", () => {
  const scalars = {
    fields: { employeeName: "Ana Horvat", netoPlaca: "1234.56" },
    metadata: { unreadableFields: ["brutoPlaca"], queuedMs: 1 },
    raw: { pass: "scalars" },
  };
  const tables = {
    fields: {
      payComponents: [{ naziv: "REDOVAN RAD", sati: null, koeficijent: null, iznos: "1200.00" }],
      obustave: [],
      neoporeziviPrimici: [],
    },
    metadata: { unreadableFields: ["payComponents.0.sati"], queuedMs: 2 },
    raw: { pass: "tables" },
  };
  let passSessionId = "";
  const repositoryA = () => new PayslipRepository(userA, userAId);

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/sessions")
      .set("Authorization", `Bearer ${tokenA}`);
    passSessionId = createSessionResponseSchema.parse(created.body).id;
  });

  /** A fresh `processing` row, inserted as user A: no source object is needed here. */
  async function processingPayslip(inSession = passSessionId): Promise<string> {
    const { data, error } = await userA
      .from("payslips")
      .insert({
        session_id: inSession,
        user_id: userAId,
        original_filename: "pass.pdf",
        content_type: "application/pdf",
        page_count: 1,
      })
      .select("id, status, tables_status")
      .single();
    if (error) throw new Error("Could not insert a processing payslip.");
    expect(data).toMatchObject({ status: "processing", tables_status: "pending" });
    return data.id;
  }

  async function row(id: string) {
    const { data, error } = await admin
      .from("payslips")
      .select("status, tables_status, canonical_data, extraction_metadata, raw_provider_result")
      .eq("id", id)
      .single();
    if (error) throw new Error(`Could not read payslip ${id}.`);
    return data;
  }

  const merged = {
    status: "review",
    tables_status: "ready",
    canonical_data: { ...scalars.fields, ...tables.fields },
    extraction_metadata: { scalars: scalars.metadata, tables: tables.metadata },
    raw_provider_result: { scalars: scalars.raw, tables: tables.raw },
  };

  it.each([
    ["scalars then tables", ["scalars", "tables"] as const],
    ["tables then scalars", ["tables", "scalars"] as const],
  ])("merges both passes whichever lands first: %s", async (_name, order) => {
    const id = await processingPayslip();
    const [first, second] = order;
    const payload = { scalars, tables };

    expect(await repositoryA().completeExtractionPass(id, first, payload[first])).toBe(true);
    if (first === "tables") {
      expect(await row(id)).toMatchObject({ status: "processing", tables_status: "ready" });
    }
    expect(await repositoryA().completeExtractionPass(id, second, payload[second])).toBe(true);

    expect(await row(id)).toEqual(merged);
    const detail = payslipDetailResponseSchema.parse((await getAsA(`/api/payslips/${id}`)).body);
    expect(detail).toMatchObject({ status: "review", tablesStatus: "ready", netoPlaca: "1234.56" });
    expect(detail.unreadableFields).toEqual(["brutoPlaca", "payComponents.0.sati"]);
  });

  it("discards a second tables write, changing nothing", async () => {
    const id = await processingPayslip();
    await repositoryA().completeExtractionPass(id, "scalars", scalars);
    await repositoryA().completeExtractionPass(id, "tables", tables);

    const again = { ...tables, fields: { ...tables.fields, obustave: null } };
    expect(await repositoryA().completeExtractionPass(id, "tables", again)).toBe(false);
    expect(await row(id)).toEqual(merged);
  });

  it("discards a scalars write to a failed payslip, and a tables write to a failed one", async () => {
    const id = await processingPayslip();
    expect(await repositoryA().failExtraction(id, "unreadable_document")).toBe(true);

    expect(await repositoryA().completeExtractionPass(id, "scalars", scalars)).toBe(false);
    expect(await repositoryA().completeExtractionPass(id, "tables", tables)).toBe(false);
    expect(await row(id)).toMatchObject({ status: "failed", canonical_data: {} });
  });

  it("discards either pass on a soft-deleted payslip", async () => {
    const id = await processingPayslip();
    await repositoryA().softDelete(id);

    expect(await repositoryA().completeExtractionPass(id, "tables", tables)).toBe(false);
    expect(await repositoryA().completeExtractionPass(id, "scalars", scalars)).toBe(false);
    expect(await row(id)).toMatchObject({ status: "processing", tables_status: "pending" });
  });

  it("refuses a second user's write to the first user's payslip", async () => {
    const id = await processingPayslip();
    const intruder = new PayslipRepository(userB, userBId);

    expect(await intruder.completeExtractionPass(id, "scalars", scalars)).toBe(false);
    expect(await intruder.completeExtractionPass(id, "tables", tables)).toBe(false);
    expect(await intruder.failTablesExtraction(id)).toBe(false);
    expect(await row(id)).toMatchObject({
      status: "processing",
      tables_status: "pending",
      canonical_data: {},
      extraction_metadata: null,
      raw_provider_result: null,
    });
  });

  it("raises on an unknown pass", async () => {
    const id = await processingPayslip();
    const { error } = await userA.rpc("complete_extraction_pass", {
      p_payslip_id: id,
      p_pass: "everything",
      p_fields: {},
      p_metadata: {},
      p_raw: {},
    });

    expect(error?.code).toBe("22023");
    expect(error?.message).toBe("invalid_pass");
  });

  it("fails pending tables on a stale payslip in review, and leaves a fresh one alone", async () => {
    const stale = await processingPayslip();
    const fresh = await processingPayslip();
    for (const id of [stale, fresh]) {
      await repositoryA().completeExtractionPass(id, "scalars", scalars);
    }
    const { error } = await admin
      .from("payslips")
      .update({ updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq("id", stale);
    if (error) throw new Error("Could not back-date the stale payslip.");

    const reaped = await repositoryA().failStaleExtractions(new Date(Date.now() - 30 * 60 * 1000));

    expect(reaped).toBe(1);
    expect(await row(stale)).toMatchObject({ status: "review", tables_status: "failed" });
    expect(await row(fresh)).toMatchObject({ status: "review", tables_status: "pending" });
  });

  describe("warnings and attention signals, computed on read (Task 06)", () => {
    // Its own session: the one above is close to the ten-payslip cap.
    let warningSessionId = "";
    const complete = {
      employerName: "Poslodavac d.o.o.",
      employeeName: "Ana Horvat",
      employeeOib: "00000000010",
      period: "2025-03",
      brutoPlaca: "1300.00",
      netoPlaca: "1040.00",
      iznosZaIsplatu: "1040.00",
    };
    const detailOf = async (id: string) =>
      payslipDetailResponseSchema.parse((await getAsA(`/api/payslips/${id}`)).body);

    beforeAll(async () => {
      const created = await request(app)
        .post("/api/sessions")
        .set("Authorization", `Bearer ${tokenA}`);
      warningSessionId = createSessionResponseSchema.parse(created.body).id;
    });

    it("raises missing and unreadable fields, and counts them in the session summary", async () => {
      const id = await processingPayslip(warningSessionId);
      await repositoryA().completeExtractionPass(
        id,
        "scalars",
        extractionPass(
          { ...complete, employerName: null, brutoPlaca: null },
          { unreadableFields: ["brutoPlaca"] },
        ),
      );

      const detail = await detailOf(id);
      expect(detail.warnings).toEqual([
        { code: "missing_critical_field", field: "employerName" },
        { code: "unparseable_amount", field: "brutoPlaca" },
      ]);
      const session = sessionDetailResponseSchema.parse(
        (await getAsA(`/api/sessions/${warningSessionId}`)).body,
      );
      expect(session.payslips.find((payslip) => payslip.id === id)?.warningCount).toBe(2);
    });

    it("serves low confidence and ungroundable fields from the pass metadata", async () => {
      const id = await processingPayslip(warningSessionId);
      await repositoryA().completeExtractionPass(
        id,
        "scalars",
        extractionPass(complete, {
          fields: { netoPlaca: { confidence: 0.2, source: "model" } },
          ungroundableFields: ["netoPlaca"],
        }),
      );

      expect(await detailOf(id)).toMatchObject({
        warnings: [],
        lowConfidenceFields: ["netoPlaca"],
        ungroundableFields: ["netoPlaca"],
      });
    });

    it("checks the pay-component sum only once the tables pass lands", async () => {
      const id = await processingPayslip(warningSessionId);
      await repositoryA().completeExtractionPass(id, "scalars", extractionPass(complete));
      expect(await detailOf(id)).toMatchObject({ tablesStatus: "pending", warnings: [] });

      await repositoryA().completeExtractionPass(id, "tables", tables);
      expect(await detailOf(id)).toMatchObject({
        tablesStatus: "ready",
        warnings: [
          // The shared tables fixture lists its null hours cell as unreadable.
          { code: "unparseable_amount", field: "payComponents.0.sati" },
          { code: "pay_components_sum_mismatch", field: "payComponents" },
        ],
      });
    });
  });
});

describe("retry (Task 07 D8)", () => {
  // Records the jobs instead of running them, so the reset and the bytes can be asserted at $0.
  const enqueued: ExtractionJob[] = [];
  const retryApp = createApp({
    extraction: {
      enqueue: (job) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  });
  let payslipId = "";

  const retry = (id: string) =>
    request(retryApp).post(`/api/payslips/${id}/retry`).set("Authorization", `Bearer ${tokenA}`);

  async function setRow(change: Database["public"]["Tables"]["payslips"]["Update"]) {
    const { error } = await admin.from("payslips").update(change).eq("id", payslipId);
    if (error) throw new Error("Could not set up the retry payslip.");
  }

  beforeAll(async () => {
    // Its own session: the others are near the ten-payslip cap.
    const created = await request(retryApp)
      .post("/api/sessions")
      .set("Authorization", `Bearer ${tokenA}`);
    const retrySessionId = createSessionResponseSchema.parse(created.body).id;

    const response = await request(retryApp)
      .post(`/api/sessions/${retrySessionId}/payslips`)
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", jpeg, { filename: "retry.jpg", contentType: "image/jpeg" });
    payslipId = createPayslipResponseSchema.parse(response.body).id;
    sourcePaths.push(sourceObjectPath(userAId, payslipId));
    enqueued.length = 0;
  });

  it("resets a retryable failure to a fresh extraction and enqueues the stored bytes", async () => {
    // A failed payslip whose tables pass landed before its scalars pass failed (history/05 item 9).
    await setRow({
      status: "failed",
      failure_reason: "provider_unavailable",
      tables_status: "ready",
      canonical_data: { brutoPlaca: "1.00", payComponents: [] },
      extraction_metadata: { tables: { unreadableFields: [] } },
      raw_provider_result: { tables: {} },
    });

    const response = await retry(payslipId);

    expect(response.status).toBe(202);
    expect(retryPayslipResponseSchema.parse(response.body)).toEqual({
      id: payslipId,
      status: "processing",
    });
    const { data } = await admin
      .from("payslips")
      .select(
        "status, tables_status, failure_reason, canonical_data, extraction_metadata, raw_provider_result",
      )
      .eq("id", payslipId)
      .single();
    expect(data).toEqual({
      status: "processing",
      tables_status: "pending",
      failure_reason: null,
      canonical_data: {},
      extraction_metadata: null,
      raw_provider_result: null,
    });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ payslipId, contentType: "image/jpeg" });
    expect(enqueued[0]?.bytes).toEqual(jpeg);
  });

  it("refuses a second retry once the first has reset the payslip", async () => {
    const response = await retry(payslipId);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code: "retry_not_allowed" } });
    expect(enqueued).toHaveLength(1);
  });

  it.each([
    ["a non-retryable failure", { status: "failed", failure_reason: "unreadable_document" }],
    ["a payslip in review", { status: "review", failure_reason: null }],
    ["a payslip still processing", { status: "processing", failure_reason: null }],
  ] as const)("refuses %s with 409", async (_name, change) => {
    await setRow(change);

    const response = await retry(payslipId);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code: "retry_not_allowed" } });
    expect(enqueued).toHaveLength(1);
  });

  it("answers 404 for a soft-deleted payslip and 400 for a malformed id", async () => {
    await setRow({
      status: "failed",
      failure_reason: "provider_unavailable",
      deleted_at: new Date().toISOString(),
    });

    expect((await retry(payslipId)).status).toBe(404);
    const malformed = await retry("not-a-uuid");
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: { code: "invalid_request" } });
    expect(enqueued).toHaveLength(1);
  });
});

describe("source regions (Task 08)", () => {
  // Its own session: the earlier ones are near the cap of ten (Task 06 deviation 4).
  let regionsSessionId = "";
  let id = "";
  const corners = [
    { x: 0.25, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.2 },
    { x: 0.25, y: 0.2 },
  ];

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/sessions")
      .set("Authorization", `Bearer ${tokenA}`);
    regionsSessionId = createSessionResponseSchema.parse(created.body).id;

    const { data, error } = await userA
      .from("payslips")
      .insert({
        session_id: regionsSessionId,
        user_id: userAId,
        original_filename: "regions.pdf",
        content_type: "application/pdf",
        page_count: 1,
      })
      .select("id")
      .single();
    if (error) throw new Error("Could not insert a processing payslip.");
    id = data.id;
  });

  async function regions() {
    const response = await getAsA(`/api/payslips/${id}/regions`);
    expect(response.status).toBe(200);
    return sourceRegionsResponseSchema.parse(response.body);
  }

  it("projects nothing while processing", async () => {
    expect(await regions()).toEqual({ pages: [], regions: [] });
  });

  it("projects the scalars pass once it lands", async () => {
    const landed = await new PayslipRepository(userA, userAId).completeExtractionPass(
      id,
      "scalars",
      {
        fields: { netoPlaca: "2298.97" },
        metadata: { unreadableFields: [], queuedMs: 1 },
        raw: regionsPassBody({ netoPlaca: sourced("2.298,97", "D(1,2,1,4,1,4,2,2,2)") }),
      },
    );
    expect(landed).toBe(true);

    expect(await regions()).toEqual({
      pages: [{ page: 1, aspectRatio: 0.8 }],
      regions: [{ fields: ["netoPlaca"], page: 1, corners, origin: "model" }],
    });
  });

  it("adds the table cells once the tables pass lands (D7)", async () => {
    const landed = await new PayslipRepository(userA, userAId).completeExtractionPass(
      id,
      "tables",
      {
        fields: {
          payComponents: [{ naziv: null, sati: null, koeficijent: null, iznos: "1200.00" }],
          obustave: [],
          neoporeziviPrimici: [],
        },
        metadata: { unreadableFields: [], queuedMs: 1 },
        raw: regionsPassBody({
          payComponents: rows({ iznos: sourced("1.200,00", "D(1,2,3,4,3,4,4,2,4)") }),
        }),
      },
    );
    expect(landed).toBe(true);

    expect((await regions()).regions.map((region) => region.fields)).toEqual([
      ["netoPlaca"],
      ["payComponents.0.iznos"],
    ]);
  });

  it("projects nothing once the payslip has failed", async () => {
    const { error } = await admin
      .from("payslips")
      .update({ status: "failed", failure_reason: "provider_unavailable" })
      .eq("id", id);
    if (error) throw new Error("Could not fail the payslip.");

    expect(await regions()).toEqual({ pages: [], regions: [] });
  });

  it("answers 400 for a malformed id", async () => {
    const response = await getAsA("/api/payslips/not-a-uuid/regions");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "invalid_request" } });
  });
});

describe("soft delete", () => {
  it("removes the payslip from every list and read, and a second delete is 404", async () => {
    const deleted = await request(app)
      .delete(`/api/payslips/${jpegPayslipId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(deleted.status).toBe(204);

    const list = listPayslipsResponseSchema.parse((await getAsA("/api/payslips?limit=100")).body);
    expect(list.items.map((payslip) => payslip.id)).not.toContain(jpegPayslipId);
    const detail = sessionDetailResponseSchema.parse(
      (await getAsA(`/api/sessions/${sessionId}`)).body,
    );
    expect(detail.payslips.map((payslip) => payslip.id)).toEqual([pdfPayslipId]);
    expect((await getAsA(`/api/payslips/${jpegPayslipId}`)).status).toBe(404);
    expect((await getAsA(`/api/payslips/${jpegPayslipId}/source`)).status).toBe(404);
    expect((await getAsA(`/api/payslips/${jpegPayslipId}/regions`)).status).toBe(404);

    const again = await request(app)
      .delete(`/api/payslips/${jpegPayslipId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(again.status).toBe(404);
  });
});

/** One extraction pass's write, with minimal metadata. */
function extractionPass(fields: object, metadata: object = {}) {
  return { fields, metadata: { unreadableFields: [], queuedMs: 1, ...metadata }, raw: {} };
}

function upload(
  token: string,
  targetSessionId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
) {
  return request(app)
    .post(`/api/sessions/${targetSessionId}/payslips`)
    .set("Authorization", `Bearer ${token}`)
    .attach("file", bytes, { filename, contentType });
}

function getAsA(path: string) {
  return request(app).get(path).set("Authorization", `Bearer ${tokenA}`);
}

async function downloadAsA(payslipId: string): Promise<Buffer> {
  const { data, error } = await userA.storage
    .from(config.STORAGE_BUCKET)
    .download(sourceObjectPath(userAId, payslipId));
  if (error || data === null) throw new Error(`Could not download ${payslipId}.`);
  return Buffer.from(await data.arrayBuffer());
}

async function pdf(pageCount: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) document.addPage();
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

/**
 * A PDF that needs a password to open: a standard-security-handler `/Encrypt` whose `/U` matches
 * no empty user password. pdf-lib cannot encrypt, but a reader asks for a password all the same.
 */
async function encryptedPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage();
  const context = document.context;
  context.trailerInfo.Encrypt = context.register(
    context.obj({
      Filter: "Standard",
      V: 1,
      R: 2,
      Length: 40,
      P: -4,
      O: PDFHexString.of(randomBytes(32).toString("hex")),
      U: PDFHexString.of(randomBytes(32).toString("hex")),
    }),
  );
  const fileId = PDFHexString.of(randomBytes(16).toString("hex"));
  context.trailerInfo.ID = context.obj([fileId, fileId]);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function createAndSignIn(
  client: SupabaseClient<Database>,
  id: string,
  email: string,
): Promise<string> {
  // `email_confirm: true` sends no email, so these runs never touch the project's email quota.
  const { error: createError } = await admin.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`Could not create integration user ${email}.`);

  const { data, error } = await client.auth.signInWithPassword({ email, password });
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
  if (!value) throw new Error(`${name} is required for Supabase integration tests.`);
  return value;
}
