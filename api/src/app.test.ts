import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Authenticator } from "./auth/authenticator.js";
import type { Database } from "./database.types.js";
import { createApp } from "./app.js";

/** Never consulted: every case below sends no token, so the header check rejects first. */
const unusedAuthenticator: Authenticator = { authenticate: () => Promise.resolve(null) };

describe("GET /api/health", () => {
  it("returns the shared HealthResponse contract", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(typeof response.body.uptimeSeconds).toBe("number");
  });
});

describe("unknown routes", () => {
  it("returns a JSON error body, not an HTML stack trace", async () => {
    const response = await request(createApp()).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found" } });
  });
});

describe("the /api/sessions and /api/payslips prefixes without a token", () => {
  const app = () => createApp({ authenticator: unusedAuthenticator });

  it("rejects a payslip request", async () => {
    const response = await request(app()).get(`/api/payslips/${randomUUID()}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it.each(["/api/payslips", "/api/sessions"])(
    "rejects %s, which has no route yet, with 401 rather than 404",
    async (path) => {
      // Proves the guard sits on the prefix. If it ever moves to individual routes, this
      // becomes 404 and every route a later task adds ships public by default.
      const response = await request(app()).get(path);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { code: "unauthorized" } });
    },
  );

  it("rejects a request carrying a forged userId query parameter", async () => {
    const response = await request(app()).get(`/api/payslips?userId=${randomUUID()}`);

    expect(response.status).toBe(401);
  });
});

describe("the protected prefixes with a valid token", () => {
  it("passes authentication and falls through to 404, because nothing is routed yet", async () => {
    // Stands in for a real Supabase client; nothing is routed, so nothing ever calls it.
    const client = {} as SupabaseClient<Database>;
    const acceptingAuthenticator: Authenticator = {
      authenticate: () => Promise.resolve({ userId: randomUUID(), client }),
    };

    const response = await request(createApp({ authenticator: acceptingAuthenticator }))
      .get(`/api/payslips/${randomUUID()}`)
      .set("Authorization", "Bearer a-token-the-stub-accepts");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found" } });
  });
});
