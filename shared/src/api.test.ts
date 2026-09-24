import { describe, expect, it } from "vitest";
import { apiErrorResponseSchema, sourceDocumentResponseSchema } from "./api.js";

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
  ])("%s accepts an unknown field added by a newer API", (_name, schema, body) => {
    const result = schema.safeParse({ ...body, aFieldThisBundleHasNeverHeardOf: null });

    expect(result.success).toBe(true);
    // Accepted, then discarded: `.strip()` rather than `.loose()`, so an undeclared field can
    // never reach a caller that has no idea what it means.
    expect(result.data).not.toHaveProperty("aFieldThisBundleHasNeverHeardOf");
  });
});
