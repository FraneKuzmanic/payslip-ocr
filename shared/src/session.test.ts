import { describe, expect, it } from "vitest";
import {
  EXTRACTION_FAILURE_REASONS,
  PAYSLIP_STATUSES,
  canTransition,
  isRetryableFailure,
  sessionSchema,
  type PayslipStatus,
} from "./session.js";

describe("payslip status machine (PRD §6.6)", () => {
  it.each<[PayslipStatus, PayslipStatus]>([
    ["processing", "review"],
    ["processing", "failed"],
    ["review", "confirmed"],
    ["failed", "processing"],
  ])("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each<[PayslipStatus, PayslipStatus]>([
    // Editing a confirmed payslip keeps it confirmed; nothing moves it back.
    ["confirmed", "review"],
    ["review", "failed"],
    // A retry goes through processing, never straight to review.
    ["failed", "review"],
    ["processing", "confirmed"],
  ])("refuses %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it.each(PAYSLIP_STATUSES)("refuses the self-transition %s → %s", (status) => {
    expect(canTransition(status, status)).toBe(false);
  });
});

describe("isRetryableFailure (PRD §7.4)", () => {
  it("retries only an unavailable provider", () => {
    expect(EXTRACTION_FAILURE_REASONS.filter(isRetryableFailure)).toEqual(["provider_unavailable"]);
  });
});

describe("sessionSchema", () => {
  const session = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-09-24T10:00:00Z",
  };

  it("accepts a session", () => {
    expect(sessionSchema.safeParse(session).success).toBe(true);
  });

  it("rejects a non-UUID id", () => {
    expect(sessionSchema.safeParse({ ...session, id: "session-1" }).success).toBe(false);
  });

  it("rejects an unknown key, including a status it does not have", () => {
    expect(sessionSchema.safeParse({ ...session, status: "review" }).success).toBe(false);
  });
});
