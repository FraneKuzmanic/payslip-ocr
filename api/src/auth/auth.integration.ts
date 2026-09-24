import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import type { Database } from "../database.types.js";

const supabaseUrl = requiredEnv("SUPABASE_URL");
const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

const userAId = randomUUID();
const password = "Task01-integration-password-123!";

// A greppable, per-run prefix: this user lives in the real hosted project, so an orphan left by a
// crashed run has to be findable. Never a fixed id or address.
const userAEmail = `task01-a-${userAId}@example.test`;

const admin = createServerClient(secretKey);
const userA = createServerClient(publishableKey);

// The real authenticator, against a real ES256 token. Stubbing it here would prove nothing.
const app = createApp();

let tokenA = "";

beforeAll(async () => {
  tokenA = await createAndSignIn(userA, userAId, userAEmail);
});

afterAll(async () => {
  // Unconditional, including after a failed assertion.
  await admin.auth.admin.deleteUser(userAId);
});

describe("the /api/payslips prefix against the hosted project", () => {
  it("rejects a request with no token", async () => {
    const response = await request(app).get(`/api/payslips/${randomUUID()}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it("rejects a token that is not a JWT", async () => {
    const response = await request(app)
      .get(`/api/payslips/${randomUUID()}`)
      .set("Authorization", "Bearer not-a-jwt");

    expect(response.status).toBe(401);
  });

  it("accepts a real ES256 token and falls through to 404, because nothing is routed yet", async () => {
    const response = await request(app)
      .get(`/api/payslips/${randomUUID()}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found" } });
  });
});

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
