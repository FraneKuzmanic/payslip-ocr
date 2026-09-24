import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JwtPayload } from "@supabase/supabase-js";
import { userIdFromClaims } from "./authenticator.js";

function claims(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    iss: "https://project.supabase.co/auth/v1",
    sub: randomUUID(),
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    role: "authenticated",
    aal: "aal1",
    session_id: randomUUID(),
    ...overrides,
  };
}

describe("userIdFromClaims", () => {
  it("accepts a signed-in user's claims and returns the subject", () => {
    const userId = randomUUID();

    expect(userIdFromClaims(claims({ sub: userId }))).toBe(userId);
  });

  it("rejects an anon token, which authenticates nobody", () => {
    expect(userIdFromClaims(claims({ role: "anon" }))).toBeNull();
  });

  it("rejects a service_role token, which would bypass Row Level Security", () => {
    expect(userIdFromClaims(claims({ role: "service_role" }))).toBeNull();
  });

  it("rejects a subject that is not a UUID, so it can never reach the repository", () => {
    expect(userIdFromClaims(claims({ sub: "not-a-uuid" }))).toBeNull();
    expect(userIdFromClaims(claims({ sub: "" }))).toBeNull();
  });
});
