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
    tables_status: "ready",
    failure_reason: null,
    canonical_data: { employeeName: "Ana Horvat", period: "2025-03", netoPlaca: "1234.56" },
    extraction_metadata: null,
    raw_provider_result: null,
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

  it.each(["pending", "ready", "failed"] as const)("maps tables_status %s", (tablesStatus) => {
    expect(mapPayslipRow(payslipRow({ tables_status: tablesStatus })).tablesStatus).toBe(
      tablesStatus,
    );
  });

  it("rejects an unknown tables_status as invalid_data", () => {
    expect(() => mapPayslipRow(payslipRow({ tables_status: "cancelled" }))).toThrow(
      expect.objectContaining({ code: "invalid_data" }),
    );
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

  it("maps a row read without raw_provider_result", () => {
    const { raw_provider_result: _raw, ...row } = payslipRow();

    expect(mapPayslipRow(row).id).toBe(PAYSLIP_ID);
  });

  it("reads money from canonical_data, never from the generated numeric column", () => {
    const payslip = mapPayslipRow(
      payslipRow({ canonical_data: { netoPlaca: "2298.970" }, neto_placa: 2298.97 }),
    );

    expect(payslip.netoPlaca).toBe("2298.970");
  });
});

describe("mapPayslipRow warnings (computed on read, Task 06 D1)", () => {
  /** Every critical field present, and an identity-free chain, so each test adds one cause. */
  const complete = {
    employerName: "Poslodavac d.o.o.",
    employeeName: "Ana Horvat",
    employeeOib: "00000000010",
    period: "2025-03",
    brutoPlaca: "100.00",
    netoPlaca: "80.00",
    iznosZaIsplatu: "80.00",
  };

  it("raises nothing for a complete, reconciling payslip", () => {
    expect(mapPayslipRow(payslipRow({ canonical_data: complete })).warnings).toEqual([]);
  });

  it("raises missing_critical_field for a review payslip without an employer", () => {
    const row = payslipRow({ canonical_data: { ...complete, employerName: null } });

    expect(mapPayslipRow(row).warnings).toEqual([
      { code: "missing_critical_field", field: "employerName" },
    ]);
  });

  it.each(["processing", "failed"])("raises nothing while the payslip is %s", (status) => {
    const row = payslipRow({ status, canonical_data: { ...complete, employerName: null } });

    expect(mapPayslipRow(row).warnings).toEqual([]);
  });

  it("checks the pay-component sum only once the tables are ready", () => {
    const canonicalData = {
      ...complete,
      payComponents: [{ naziv: "Rad", sati: null, koeficijent: null, iznos: "90.00" }],
    };
    const mismatch = [{ code: "pay_components_sum_mismatch", field: "payComponents" }];

    expect(mapPayslipRow(payslipRow({ canonical_data: canonicalData })).warnings).toEqual(mismatch);
    expect(
      mapPayslipRow(payslipRow({ canonical_data: canonicalData, tables_status: "pending" }))
        .warnings,
    ).toEqual([]);
  });

  it("raises unparseable_date for an unreadable period still null", () => {
    const row = payslipRow({
      canonical_data: { ...complete, period: null },
      extraction_metadata: { scalars: { unreadableFields: ["period"] } },
    });

    expect(mapPayslipRow(row).warnings).toEqual([{ code: "unparseable_date", field: "period" }]);
  });

  it("rejects malformed extraction metadata as invalid_data", () => {
    const row = payslipRow({ extraction_metadata: { scalars: { unreadableFields: "period" } } });

    expect(() => mapPayslipRow(row)).toThrow(expect.objectContaining({ code: "invalid_data" }));
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

describe("PayslipRepository.findDetailState", () => {
  it.each([
    ["null metadata", null, []],
    [
      "the scalars pass alone",
      { scalars: { unreadableFields: ["brutoPlaca"], latencyMs: 1 } },
      ["brutoPlaca"],
    ],
    [
      "both passes, scalars first",
      {
        tables: { unreadableFields: ["obustave.0.iznos"] },
        scalars: { unreadableFields: ["brutoPlaca"] },
      },
      ["brutoPlaca", "obustave.0.iznos"],
    ],
  ])("reads unreadableFields from %s", async (_name, metadata, expected) => {
    const repository = new PayslipRepository(
      singleRow(payslipRow({ extraction_metadata: metadata })),
      USER_ID,
    );

    expect((await repository.findDetailState(PAYSLIP_ID))?.unreadableFields).toEqual(expected);
  });

  it("projects low confidence and grounding from both passes, scalars first", async () => {
    const metadata = {
      tables: {
        unreadableFields: [],
        ungroundableFields: ["obustave.0.naziv"],
        fields: { "obustave.0.iznos": { confidence: 0.1, source: "model" } },
      },
      scalars: {
        unreadableFields: [],
        ungroundableFields: ["iznosZaIsplatu"],
        fields: {
          iznosZaIsplatu: { confidence: 0.04, source: "model" },
          netoPlaca: { confidence: 0.9, source: "model" },
          period: { confidence: null, source: "model" },
        },
      },
    };
    const repository = new PayslipRepository(
      singleRow(payslipRow({ extraction_metadata: metadata })),
      USER_ID,
    );

    expect(await repository.findDetailState(PAYSLIP_ID)).toMatchObject({
      lowConfidenceFields: ["iznosZaIsplatu", "obustave.0.iznos"],
      ungroundableFields: ["iznosZaIsplatu", "obustave.0.naziv"],
    });
  });

  it("reads metadata written before Task 06 as no attention signals", async () => {
    const repository = new PayslipRepository(
      singleRow(payslipRow({ extraction_metadata: { scalars: { unreadableFields: [] } } })),
      USER_ID,
    );

    expect(await repository.findDetailState(PAYSLIP_ID)).toMatchObject({
      lowConfidenceFields: [],
      ungroundableFields: [],
    });
  });

  it("rejects malformed extraction metadata as invalid_data", async () => {
    const repository = new PayslipRepository(
      singleRow(
        payslipRow({ extraction_metadata: { scalars: { unreadableFields: "brutoPlaca" } } }),
      ),
      USER_ID,
    );

    await expect(repository.findDetailState(PAYSLIP_ID)).rejects.toMatchObject({
      code: "invalid_data",
    });
  });

  it("carries the original filename (Task 07 D9)", async () => {
    const repository = new PayslipRepository(singleRow(payslipRow()), USER_ID);

    expect((await repository.findDetailState(PAYSLIP_ID))?.originalFilename).toBe(
      "platna-lista.pdf",
    );
  });
});

describe("PayslipRepository.beginRetry (Task 07 D8)", () => {
  it("resets to a fresh extraction, only from a live, owned, retryable failure", async () => {
    const { client, calls } = recordingUpdate(
      payslipRow({ status: "processing", tables_status: "pending", canonical_data: {} }),
    );

    const payslip = await new PayslipRepository(client, USER_ID).beginRetry(PAYSLIP_ID);

    expect(payslip).toMatchObject({ status: "processing", tablesStatus: "pending" });
    expect(calls).toEqual([
      [
        "update",
        {
          status: "processing",
          tables_status: "pending",
          failure_reason: null,
          canonical_data: {},
          extraction_metadata: null,
          raw_provider_result: null,
          edited_fields: [],
          updated_at: expect.any(String),
        },
      ],
      ["eq", "id", PAYSLIP_ID],
      ["eq", "user_id", USER_ID],
      ["eq", "status", "failed"],
      ["in", "failure_reason", ["provider_unavailable"]],
      ["is", "deleted_at", null],
      ["select", expect.not.stringContaining("raw_provider_result")],
    ]);
  });

  it("returns null when no row matched: not retryable now, or a concurrent retry won", async () => {
    const { client } = recordingUpdate(null);

    expect(await new PayslipRepository(client, USER_ID).beginRetry(PAYSLIP_ID)).toBeNull();
  });
});

/** The `from().select().eq().eq().is().maybeSingle()` chain `findDetailState` uses. */
function singleRow(row: PayslipRow): SupabaseClient<Database> {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}

/** The `from().update()…maybeSingle()` chain `beginRetry` uses, recording every call. */
function recordingUpdate(row: PayslipRow | null) {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return chain;
    };
  const chain = {
    update: record("update"),
    eq: record("eq"),
    in: record("in"),
    is: record("is"),
    select: record("select"),
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { client: { from: () => chain } as unknown as SupabaseClient<Database>, calls };
}

/** The minimal `from().insert().select().single()` chain `create` uses, resolving to an error. */
function failingInsert(error: { code: string; message: string }): SupabaseClient<Database> {
  const chain = {
    insert: () => chain,
    select: () => chain,
    single: () => Promise.resolve({ data: null, error }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}
