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
  /** One obustave row, so signals on `obustave.0.*` point at a row that exists (Task 09 D6). */
  const withObustava = { employeeName: "Ana Horvat", obustave: [{ naziv: "KREDIT", iznos: null }] };

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
      singleRow(payslipRow({ canonical_data: withObustava, extraction_metadata: metadata })),
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
      singleRow(payslipRow({ canonical_data: withObustava, extraction_metadata: metadata })),
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

describe("PayslipRepository.findRetainedResponses (Task 08 D7, Task 09 D4)", () => {
  const raw = { scalars: { id: "op" } };

  it.each(["review", "confirmed"] as const)("returns the retained bodies in %s", async (status) => {
    const repository = new PayslipRepository(
      singleRow(payslipRow({ status, raw_provider_result: raw })),
      USER_ID,
    );

    expect(await repository.findRetainedResponses(PAYSLIP_ID)).toEqual({
      status,
      tablesStatus: "ready",
      fields: { employeeName: "Ana Horvat", period: "2025-03", netoPlaca: "1234.56" },
      rawProviderResult: raw,
    });
  });

  it.each(["processing", "failed"] as const)("withholds the bodies in %s", async (status) => {
    const repository = new PayslipRepository(
      singleRow(payslipRow({ status, raw_provider_result: raw })),
      USER_ID,
    );

    expect(await repository.findRetainedResponses(PAYSLIP_ID)).toMatchObject({
      rawProviderResult: null,
    });
  });

  it("returns null when the row is absent", async () => {
    const repository = new PayslipRepository(singleRow(null), USER_ID);

    expect(await repository.findRetainedResponses(PAYSLIP_ID)).toBeNull();
  });

  it("rejects malformed canonical data as invalid_data", async () => {
    const repository = new PayslipRepository(
      singleRow(payslipRow({ canonical_data: { brutto: "1.00" } })),
      USER_ID,
    );

    await expect(repository.findRetainedResponses(PAYSLIP_ID)).rejects.toMatchObject({
      code: "invalid_data",
    });
  });
});

describe("PayslipRepository writes go through functions (Task 09 D2)", () => {
  const CUTOFF = new Date("2026-09-26T08:00:00.000Z");

  it.each([
    [
      "updateFields",
      (r: PayslipRepository) => r.updateFields(PAYSLIP_ID, { netoPlaca: "1.00" }, ["netoPlaca"]),
      "update_payslip_fields",
      { p_payslip_id: PAYSLIP_ID, p_fields: { netoPlaca: "1.00" }, p_edited_fields: ["netoPlaca"] },
      true,
      true,
    ],
    [
      "softDelete",
      (r: PayslipRepository) => r.softDelete(PAYSLIP_ID),
      "soft_delete_payslip",
      { p_payslip_id: PAYSLIP_ID },
      true,
      true,
    ],
    [
      "beginRetry",
      (r: PayslipRepository) => r.beginRetry(PAYSLIP_ID),
      "begin_payslip_retry",
      { p_payslip_id: PAYSLIP_ID, p_retryable_reasons: ["provider_unavailable"] },
      true,
      true,
    ],
    [
      "failExtraction",
      (r: PayslipRepository) => r.failExtraction(PAYSLIP_ID, "unreadable_document"),
      "fail_payslip_extraction",
      { p_payslip_id: PAYSLIP_ID, p_reason: "unreadable_document" },
      true,
      true,
    ],
    [
      "failTablesExtraction",
      (r: PayslipRepository) => r.failTablesExtraction(PAYSLIP_ID),
      "fail_payslip_tables",
      { p_payslip_id: PAYSLIP_ID },
      true,
      true,
    ],
    [
      "failStaleExtractions",
      (r: PayslipRepository) => r.failStaleExtractions(CUTOFF),
      "fail_stale_payslip_extractions",
      { p_cutoff: "2026-09-26T08:00:00.000Z" },
      2,
      2,
    ],
    [
      "confirm",
      (r: PayslipRepository) => r.confirm(PAYSLIP_ID),
      "confirm_payslip",
      { p_payslip_id: PAYSLIP_ID },
      "2026-09-26 10:00:00.5+02",
      "2026-09-26T08:00:00.500Z",
    ],
  ] as const)(
    "%s calls %s with exactly its parameters",
    async (_name, call, fn, args, data, result) => {
      const { client, calls } = recordingRpc(data);

      expect(await call(new PayslipRepository(client, USER_ID))).toEqual(result);
      expect(calls).toEqual([[fn, args]]);
    },
  );

  it.each([
    ["updateFields", (r: PayslipRepository) => r.updateFields(PAYSLIP_ID, {}, []), false, false],
    ["softDelete", (r: PayslipRepository) => r.softDelete(PAYSLIP_ID), false, false],
    ["beginRetry", (r: PayslipRepository) => r.beginRetry(PAYSLIP_ID), false, false],
    ["confirm", (r: PayslipRepository) => r.confirm(PAYSLIP_ID), null, null],
    ["failStaleExtractions", (r: PayslipRepository) => r.failStaleExtractions(new Date()), 0, 0],
  ] as const)("%s reports a write that matched nothing", async (_name, call, data, result) => {
    expect(await call(new PayslipRepository(recordingRpc(data).client, USER_ID))).toEqual(result);
  });

  it("maps a function error to query_failed", async () => {
    const { client } = recordingRpc(null, { code: "42501", message: "permission denied" });

    await expect(
      new PayslipRepository(client, USER_ID).softDelete(PAYSLIP_ID),
    ).rejects.toMatchObject({ code: "query_failed" });
  });
});

describe("edited values drop their machine signals (Task 09 D6)", () => {
  const metadata = {
    scalars: {
      unreadableFields: ["brutoPlaca"],
      ungroundableFields: ["netoPlaca"],
      fields: {
        netoPlaca: { confidence: 0.1, source: "model" },
        employerOib: { confidence: 0.2, source: "model" },
      },
    },
    tables: {
      unreadableFields: ["obustave.1.iznos"],
      ungroundableFields: ["obustave.0.naziv"],
      fields: { "obustave.1.naziv": { confidence: 0.1, source: "model" } },
    },
  };
  const canonicalData = {
    employeeName: "Ana Horvat",
    netoPlaca: "1.00",
    brutoPlaca: "2.00",
    obustave: [{ naziv: "KREDIT", iznos: "5.00" }],
  };

  it("drops edited paths and paths to removed rows from all three lists", async () => {
    const repository = new PayslipRepository(
      singleRow(
        payslipRow({
          canonical_data: canonicalData,
          extraction_metadata: metadata,
          edited_fields: ["netoPlaca", "brutoPlaca"],
        }),
      ),
      USER_ID,
    );

    expect(await repository.findDetailState(PAYSLIP_ID)).toMatchObject({
      editedFields: ["netoPlaca", "brutoPlaca"],
      unreadableFields: [],
      lowConfidenceFields: ["employerOib"],
      ungroundableFields: ["obustave.0.naziv"],
    });
  });

  it("raises no unparseable_amount for an unreadable cell of a removed row", () => {
    // Both unreadable values still null, so each would raise `unparseable_amount` while live.
    const row = payslipRow({
      canonical_data: { ...canonicalData, brutoPlaca: null },
      extraction_metadata: metadata,
      edited_fields: ["brutoPlaca"],
    });

    expect(mapPayslipRow(row).warnings).not.toContainEqual(
      expect.objectContaining({ code: "unparseable_amount" }),
    );
    expect(
      mapPayslipRow({ ...row, edited_fields: [] }).warnings.filter(
        (warning) => warning.code === "unparseable_amount",
      ),
    ).toEqual([{ code: "unparseable_amount", field: "brutoPlaca" }]);
  });
});

/** The `from().select().eq().eq().is().maybeSingle()` chain `findDetailState` uses. */
function singleRow(row: PayslipRow | null): SupabaseClient<Database> {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}

/** An `rpc` client recording each function name and its arguments. */
function recordingRpc(data: unknown, error: { code: string; message: string } | null = null) {
  const calls: unknown[][] = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return Promise.resolve({ data, error });
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
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
