import { describe, expect, it } from "vitest";
import {
  apiErrorResponseSchema,
  confirmPayslipResponseSchema,
  createPayslipResponseSchema,
  createSessionResponseSchema,
  listPayslipsQuerySchema,
  listPayslipsResponseSchema,
  mergePayslipsRequestSchema,
  mergePayslipsResponseSchema,
  payslipDetailResponseSchema,
  payslipSummarySchema,
  retryPayslipResponseSchema,
  sessionDetailResponseSchema,
  sourceDocumentResponseSchema,
  updatePayslipRequestSchema,
} from "./api.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-09-24T10:00:00Z";

const payslip = {
  id: ID_A,
  sessionId: ID_B,
  userId: USER,
  status: "review",
  tablesStatus: "ready",
  pageCount: 1,
  currency: "EUR",
  warnings: [{ code: "neto_mismatch", field: "netoPlaca" }],
  createdAt: NOW,
  updatedAt: NOW,
  netoPlaca: "2298.97",
};

const sourceDocument = {
  url: "https://example.test/signed",
  contentType: "image/jpeg",
  originalFilename: "payslip.jpg",
  expiresAt: "2026-08-17T12:05:00Z",
};

/**
 * A browser tab left open across a deploy runs the previous bundle against the new API, so a field
 * the API has since added must be ignored rather than rejected. When these schemas were `.strict()`
 * that was not true: shipping `failureReason` on 2026-08-26 made every open tab in the sibling
 * prototype reject every response, which surfaced as the generic processing-error screen on
 * documents that had extracted perfectly, and cost a client demo.
 */
describe("response DTOs tolerate a newer API", () => {
  it.each([
    ["sourceDocumentResponseSchema", sourceDocumentResponseSchema, sourceDocument],
    ["apiErrorResponseSchema", apiErrorResponseSchema, { error: { code: "not_found" } }],
    ["createSessionResponseSchema", createSessionResponseSchema, { id: ID_B, createdAt: NOW }],
    [
      "createPayslipResponseSchema",
      createPayslipResponseSchema,
      { id: ID_A, sessionId: ID_B, status: "processing", createdAt: NOW },
    ],
    [
      "sessionDetailResponseSchema",
      sessionDetailResponseSchema,
      {
        id: ID_B,
        createdAt: NOW,
        payslips: [
          {
            id: ID_A,
            status: "failed",
            tablesStatus: "failed",
            period: null,
            employeeName: null,
            pageCount: 1,
            failureReason: "provider_unavailable",
            warningCount: 0,
          },
        ],
      },
    ],
    [
      "payslipDetailResponseSchema",
      payslipDetailResponseSchema,
      {
        ...payslip,
        lowConfidenceFields: ["employeeOib"],
        unreadableFields: [],
        editedFields: ["netoPlaca"],
        failureReason: null,
      },
    ],
    [
      "confirmPayslipResponseSchema",
      confirmPayslipResponseSchema,
      { id: ID_A, status: "confirmed", confirmedAt: NOW },
    ],
    ["retryPayslipResponseSchema", retryPayslipResponseSchema, { id: ID_A, status: "processing" }],
    [
      "mergePayslipsResponseSchema",
      mergePayslipsResponseSchema,
      { id: ID_A, status: "processing" },
    ],
    [
      "listPayslipsResponseSchema",
      listPayslipsResponseSchema,
      { items: [payslip], page: 1, limit: 20, total: 1 },
    ],
  ])("%s accepts an unknown field added by a newer API", (_name, schema, body) => {
    const result = schema.safeParse({ ...body, aFieldThisBundleHasNeverHeardOf: null });

    expect(result.success).toBe(true);
    // Accepted, then discarded: `.strip()` rather than `.loose()`, so an undeclared field can
    // never reach a caller that has no idea what it means.
    expect(result.data).not.toHaveProperty("aFieldThisBundleHasNeverHeardOf");
  });
});

describe("updatePayslipRequestSchema (PRD §10.6)", () => {
  // Strictness survives `.partial()`: a body naming a server-owned key is rejected outright.
  it.each(["userId", "status", "tablesStatus", "currency", "id", "sessionId"])(
    "rejects %s",
    (key) => {
      expect(
        updatePayslipRequestSchema.safeParse({ [key]: payslip[key as keyof typeof payslip] })
          .success,
      ).toBe(false);
    },
  );

  it.each([{}, { netoPlaca: "2298.97" }])("accepts %j", (body) => {
    expect(updatePayslipRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects an amount in its printed form", () => {
    expect(updatePayslipRequestSchema.safeParse({ netoPlaca: "2.298,97" }).success).toBe(false);
  });
});

describe("payslipSummarySchema (PRD §10.4)", () => {
  const summary = {
    id: ID_A,
    status: "processing",
    tablesStatus: "pending",
    period: null,
    employeeName: null,
    pageCount: 1,
    failureReason: null,
    warningCount: 0,
  };

  it.each(["period", "employeeName"] as const)("requires %s, even when null", (key) => {
    const { [key]: _omitted, ...body } = summary;
    expect(payslipSummarySchema.safeParse(body).success).toBe(false);
  });
  it("carries tablesStatus, so a client knows the line-item tables are still coming", () => {
    expect(payslipSummarySchema.parse(summary).tablesStatus).toBe("pending");
  });
});

describe("mergePayslipsRequestSchema (PRD §10.11)", () => {
  it.each([
    { payslipIds: [ID_A, ID_B], order: [ID_A, ID_B] },
    { payslipIds: [ID_A, ID_B], order: [ID_B, ID_A] },
  ])("accepts %j", (body) => {
    expect(mergePayslipsRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ["identical ids", { payslipIds: [ID_A, ID_A], order: [ID_A, ID_A] }],
    ["an order naming another payslip", { payslipIds: [ID_A, ID_B], order: [ID_A, USER] }],
    ["an order repeating one payslip", { payslipIds: [ID_A, ID_B], order: [ID_A, ID_A] }],
    ["three ids", { payslipIds: [ID_A, ID_B, USER], order: [ID_A, ID_B, USER] }],
    ["an extra key", { payslipIds: [ID_A, ID_B], order: [ID_A, ID_B], force: true }],
  ])("rejects %s", (_name, body) => {
    expect(mergePayslipsRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("listPayslipsQuerySchema (PRD §10.12)", () => {
  it("coerces query-string counts and applies defaults", () => {
    expect(listPayslipsQuerySchema.parse({ page: "2" })).toEqual({ page: 2, limit: 20 });
  });

  it("rejects a limit above 100", () => {
    expect(listPayslipsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
