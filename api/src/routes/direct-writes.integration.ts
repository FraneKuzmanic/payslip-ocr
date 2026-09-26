import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";
import {
  mappedPass,
  regionsPassBody,
  sourced,
} from "../providers/document-extraction/content-understanding/regions.fixture.js";
import { PayslipRepository } from "../repositories/payslips.js";

// Task 09 D3: passes only once migration `revoke_direct_payslip_updates` is applied, so it joins the
// runner's file list in post-push step P, not before. Until then the direct writes below succeed.

const userId = randomUUID();
const password = "Task09-integration-password-123!";
// Greppable, per-run: these users live in the real hosted project.
const email = `task09-direct-${userId}@example.test`;

const supabaseUrl = requiredEnv("SUPABASE_URL");
const admin = createServerClient(requiredEnv("SUPABASE_SECRET_KEY"));
const user = createServerClient(requiredEnv("SUPABASE_PUBLISHABLE_KEY"));

let sessionId = "";
let payslipId = "";

beforeAll(async () => {
  const { error: createError } = await admin.auth.admin.createUser({
    id: userId,
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`Could not create integration user ${email}.`);
  const { error: signInError } = await user.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Could not sign in integration user ${email}.`);

  const session = await user.from("sessions").insert({ user_id: userId }).select("id").single();
  if (session.error) throw new Error("Could not create a session.");
  sessionId = session.data.id;
  const payslip = await user
    .from("payslips")
    .insert({
      session_id: sessionId,
      user_id: userId,
      original_filename: "direct.pdf",
      content_type: "application/pdf",
      page_count: 1,
    })
    .select("id")
    .single();
  if (payslip.error) throw new Error("Could not insert a payslip.");
  payslipId = payslip.data.id;

  // Writing through the function still works: it is the only way in.
  const body = regionsPassBody({ netoPlaca: sourced("1.040,00", "D(1,1,1,2,1,2,2,1,2)") });
  const landed = await new PayslipRepository(user, userId).completeExtractionPass(
    payslipId,
    "scalars",
    mappedPass(body, "scalars"),
  );
  if (!landed) throw new Error("Could not complete the scalars pass.");
});

afterAll(async () => {
  // Rows cascade from the user. No source object was uploaded.
  await admin.auth.admin.deleteUser(userId);
});

describe("direct writes after Task 09 migration 2", () => {
  it.each([
    ["confirming", { status: "confirmed" }],
    ["replacing the canonical data", { canonical_data: {} }],
    ["soft-deleting", { deleted_at: new Date().toISOString() }],
  ] as const)("refuses %s through PostgREST, changing nothing", async (_name, change) => {
    const { error } = await user.from("payslips").update(change).eq("id", payslipId);

    expect(error).not.toBeNull();
    const { data } = await admin
      .from("payslips")
      .select("status, canonical_data, deleted_at")
      .eq("id", payslipId)
      .single();
    expect(data).toEqual({
      status: "review",
      canonical_data: expect.objectContaining({ netoPlaca: "1040.00" }),
      deleted_at: null,
    });
  });

  it("refuses inserting a payslip that skips extraction", async () => {
    const { error } = await user.from("payslips").insert({
      session_id: sessionId,
      user_id: userId,
      original_filename: "forged.pdf",
      content_type: "application/pdf",
      page_count: 1,
      status: "confirmed",
      tables_status: "ready",
      canonical_data: { netoPlaca: "1.00" },
    });

    expect(error?.code).toBe("42501");
  });
});

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
