import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { payslipSchema } from "@payslip/shared";
import type { Database } from "../database.types.js";
import { PayslipRepository, PayslipRepositoryError, mapPayslipRow } from "./payslips.js";

type PayslipRow = Database["public"]["Tables"]["payslips"]["Row"];

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PAYSLIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function payslipRow(overrides: Partial<PayslipRow> = {}): PayslipRow {
  return {
    id: PAYSLIP_ID,
    session_id: SESSION_ID,
    user_id: USER_ID,
    status: "review",
    failure_reason: null,
    canonical_data: { employeeName: "Ana Horvat", period: "2025-03", netoPlaca: "1234.56" },
    extraction_metadata: null,
    raw_provider_result: null,
    warnings: [],
    edited_fields: [],
    original_filename: "platna-lista.pdf",
    content_type: "application/pdf",
    page_count: 2,
    merged_from: null,
    confirmed_at: null,
    created_at: "2026-09-24T10:00:00.123456+00:00",
    updated_at: "2026-09-24 12:30:00+02",
    deleted_at: null,
    employee_name: "Ana Horvat",
    employer_name: null,
    period: "2025-03",
    neto_placa: 1234.56,
    iznos_za_isplatu: null,
    ...overrides,
  };
}

describe("mapPayslipRow", () => {
  it("maps a complete row to a Payslip that satisfies the shared schema", () => {
    const payslip = mapPayslipRow(payslipRow());

    expect(payslipSchema.parse(payslip)).toEqual(payslip);
    expect(payslip).toMatchObject({
      id: PAYSLIP_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      status: "review",
      pageCount: 2,
      currency: "EUR",
      employeeName: "Ana Horvat",
      period: "2025-03",
    });
  });

  it("normalizes PostgREST timestamps to ISO UTC", () => {
    const payslip = mapPayslipRow(payslipRow());

    expect(payslip.createdAt).toBe("2026-09-24T10:00:00.123Z");
    expect(payslip.updatedAt).toBe("2026-09-24T10:30:00.000Z");
  });

  it.each([
    ["an unknown key", { employeeName: "Ana", brutto: "1.00" }],
    ["a printed, un-normalised amount", { netoPlaca: "2.298,97" }],
  ])("rejects canonical_data holding %s as invalid_data", (_name, canonicalData) => {
    expect(() => mapPayslipRow(payslipRow({ canonical_data: canonicalData }))).toThrow(
      expect.objectContaining({ name: "PayslipRepositoryError", code: "invalid_data" }),
    );
  });

  it("reads money from canonical_data, never from the generated numeric column", () => {
    const payslip = mapPayslipRow(
      payslipRow({ canonical_data: { netoPlaca: "2298.970" }, neto_placa: 2298.97 }),
    );

    expect(payslip.netoPlaca).toBe("2298.970");
  });
});

describe("PayslipRepository.create", () => {
  const input = {
    id: PAYSLIP_ID,
    sessionId: SESSION_ID,
    originalFilename: "payslip.jpg",
    contentType: "image/jpeg",
    pageCount: 1,
  } as const;

  it("maps the cap trigger's error to session_full", async () => {
    const repository = new PayslipRepository(
      failingInsert({ code: "P0001", message: "session_full" }),
      USER_ID,
    );

    await expect(repository.create(input)).rejects.toMatchObject({ code: "session_full" });
  });

  it.each([
    { code: "42501", message: "new row violates row-level security policy" },
    { code: "P0001", message: "something else" },
  ])("maps any other error to query_failed", async (error) => {
    const repository = new PayslipRepository(failingInsert(error), USER_ID);

    const rejection = repository.create(input);
    await expect(rejection).rejects.toBeInstanceOf(PayslipRepositoryError);
    await expect(rejection).rejects.toMatchObject({ code: "query_failed" });
  });
});

/** The minimal `from().insert().select().single()` chain `create` uses, resolving to an error. */
function failingInsert(error: { code: string; message: string }): SupabaseClient<Database> {
  const chain = {
    insert: () => chain,
    select: () => chain,
    single: () => Promise.resolve({ data: null, error }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}
