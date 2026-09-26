import { describe, expect, it } from "vitest";
import {
  EXTRACTION_FAILURE_REASONS,
  PAYSLIP_STATUSES,
  TABLES_STATUSES,
  canTransition,
  isMergeable,
  isRetryableFailure,
  mergeSuggestions,
  mergedFilename,
  sessionSchema,
  tablesStatusSchema,
  type MergeCandidate,
  type PayslipStatus,
  type TablesStatus,
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

describe("tables status (Task 05 D6)", () => {
  it("is a closed set of three", () => {
    expect(TABLES_STATUSES).toEqual(["pending", "ready", "failed"]);
  });

  it.each(["processing", "review", "cancelled", ""])("rejects %j", (value) => {
    expect(tablesStatusSchema.safeParse(value).success).toBe(false);
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

describe("isMergeable (plan 11 D3)", () => {
  it.each<[PayslipStatus, TablesStatus, boolean]>([
    ["processing", "pending", false],
    ["processing", "ready", false],
    ["processing", "failed", false],
    ["review", "pending", false],
    ["review", "ready", true],
    ["review", "failed", true],
    ["confirmed", "pending", true],
    ["confirmed", "ready", true],
    ["confirmed", "failed", true],
    ["failed", "pending", true],
    ["failed", "ready", true],
    ["failed", "failed", true],
  ])("%s with tables %s → %s", (status, tablesStatus, expected) => {
    expect(isMergeable(status, tablesStatus)).toBe(expected);
  });
});

function candidate(id: string, fields: Partial<MergeCandidate> = {}): MergeCandidate {
  return {
    id,
    status: "review",
    tablesStatus: "ready",
    period: "2026-08",
    employeeOib: "69435151530",
    employerOib: "12345678903",
    ...fields,
  };
}

describe("mergeSuggestions (plan 11 D5)", () => {
  it("pairs the same employee OIB and period", () => {
    expect(mergeSuggestions([candidate("a"), candidate("b")])).toEqual([["a", "b"]]);
  });

  it("does not pair different periods", () => {
    expect(mergeSuggestions([candidate("a"), candidate("b", { period: "2026-07" })])).toEqual([]);
  });

  it("does not pair two different employee OIBs under one employer", () => {
    expect(
      mergeSuggestions([candidate("a"), candidate("b", { employeeOib: "94577403194" })]),
    ).toEqual([]);
  });

  it("falls back to the employer OIB when one employee OIB is unread", () => {
    expect(mergeSuggestions([candidate("a"), candidate("b", { employeeOib: null })])).toEqual([
      ["a", "b"],
    ]);
    expect(mergeSuggestions([candidate("a", { employeeOib: undefined }), candidate("b")])).toEqual([
      ["a", "b"],
    ]);
  });

  it("does not pair unread employee OIBs whose employer OIBs differ", () => {
    expect(
      mergeSuggestions([
        candidate("a", { employeeOib: null }),
        candidate("b", { employeeOib: null, employerOib: "94577403194" }),
      ]),
    ).toEqual([]);
  });

  it("does not pair on an unread employer OIB either", () => {
    expect(
      mergeSuggestions([
        candidate("a", { employeeOib: null, employerOib: null }),
        candidate("b", { employeeOib: null, employerOib: null }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ["first", [candidate("a", { period: null }), candidate("b")]],
    ["second", [candidate("a"), candidate("b", { period: undefined })]],
  ])("does not pair when the %s period is unread", (_side, payslips) => {
    expect(mergeSuggestions(payslips)).toEqual([]);
  });

  it.each<[string, Partial<MergeCandidate>]>([
    ["processing", { status: "processing", tablesStatus: "pending" }],
    ["failed", { status: "failed" }],
    ["review with tables pending", { tablesStatus: "pending" }],
  ])("does not pair a payslip that is %s", (_name, fields) => {
    expect(mergeSuggestions([candidate("a"), candidate("b", fields)])).toEqual([]);
  });

  it("pairs a confirmed payslip with one in review", () => {
    expect(mergeSuggestions([candidate("a", { status: "confirmed" }), candidate("b")])).toEqual([
      ["a", "b"],
    ]);
  });

  it("returns every matching pair in list order", () => {
    expect(mergeSuggestions([candidate("a"), candidate("b"), candidate("c")])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("compares OIBs and periods trimmed", () => {
    expect(
      mergeSuggestions([candidate("a"), candidate("b", { employeeOib: " 69435151530 " })]),
    ).toEqual([["a", "b"]]);
  });
});

describe("mergedFilename (plan 11 D9)", () => {
  it("joins both names in page order", () => {
    expect(mergedFilename("page-2.jpg", "page-1.jpg")).toBe("page-2.jpg + page-1.jpg");
  });

  it("stays within 255 characters", () => {
    expect(mergedFilename("a".repeat(200), "b".repeat(200))).toHaveLength(255);
  });
});
