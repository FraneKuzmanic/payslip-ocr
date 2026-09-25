import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalPayslipFieldsSchema,
  extractionFailureReasonSchema,
  payslipSchema,
  sourceContentTypeSchema,
  tablesStatusSchema,
  type CanonicalPayslipFields,
  type ExtractionFailureReason,
  type Payslip,
  type PayslipStatus,
  type SourceContentType,
} from "@payslip/shared";
import type { Database, Json } from "../database.types.js";
import type { ExtractionPass } from "../providers/document-extraction/types.js";
import { lowConfidenceFields } from "../validation/attention.js";
import { computeWarnings } from "../validation/warnings.js";

type PayslipRow = Database["public"]["Tables"]["payslips"]["Row"];
type PayslipUpdate = Database["public"]["Tables"]["payslips"]["Update"];

/** Every column a read needs. `raw_provider_result` is 0.2–1 MB per row and is never read here. */
type PayslipReadRow = Omit<PayslipRow, "raw_provider_result">;

/**
 * Every `payslips` column except `raw_provider_result` (Task 04 D11): a session poll of ten
 * payslips would otherwise move up to ~10 MB. Only a source-region projection reads the raw column.
 */
const PAYSLIP_COLUMNS =
  "id, session_id, user_id, status, tables_status, failure_reason, canonical_data, extraction_metadata, edited_fields, original_filename, content_type, page_count, merged_from, confirmed_at, created_at, updated_at, deleted_at, employee_name, employer_name, period, neto_placa, iznos_za_isplatu";

const uuidSchema = z.uuid();
/** Statuses with a readable form, the only ones that carry warnings (Task 06 D2). */
const WARNED_STATUSES: readonly string[] = ["review", "confirmed"];
const failureReasonSchema = extractionFailureReasonSchema.nullable();
/**
 * The parts of one pass's metadata that reads project. `ungroundableFields` and `fields` default
 * to empty, so metadata written before Task 06 still parses.
 */
const passMetadataSchema = z
  .object({
    unreadableFields: z.array(z.string()),
    ungroundableFields: z.array(z.string()).default([]),
    fields: z
      .record(z.string(), z.object({ confidence: z.number().nullable() }).loose())
      .default({}),
  })
  .loose();
/** `{ scalars?, tables? }`: each extraction pass merges its own metadata (Task 05 D7). */
const extractionMetadataSchema = z
  .object({ scalars: passMetadataSchema.optional(), tables: passMetadataSchema.optional() })
  .loose()
  .nullable();

export interface CreatePayslipInput {
  readonly id: string;
  readonly sessionId: string;
  readonly originalFilename: string;
  readonly contentType: SourceContentType;
  readonly pageCount: number;
}

/** Tasks 04 and 09 extend this as extraction and editing land. */
export interface UpdatePayslipInput {
  readonly deletedAt?: string;
}

/** A payslip plus the row state `Payslip` deliberately does not carry. */
export interface PayslipState {
  readonly payslip: Payslip;
  readonly failureReason: ExtractionFailureReason | null;
}

export interface PayslipDetailState extends PayslipState {
  readonly editedFields: string[];
  readonly unreadableFields: string[];
  readonly lowConfidenceFields: string[];
  readonly ungroundableFields: string[];
}

/** One successful extraction pass, merged into the row in one statement. */
export interface CompletedExtraction {
  /** Only the pass's own keys: the merge replaces top-level keys, so another key would erase. */
  readonly fields: Partial<CanonicalPayslipFields>;
  readonly metadata: Json;
  readonly raw: Json;
}

export interface PayslipSourceMetadata {
  readonly contentType: SourceContentType;
  readonly originalFilename: string;
}

export interface ListPayslipsOptions {
  readonly page: number;
  readonly limit: number;
  readonly status?: PayslipStatus;
}

export interface PayslipPage {
  readonly items: Payslip[];
  readonly total: number;
}

export type PayslipRepositoryErrorCode = "invalid_data" | "query_failed" | "session_full";

export class PayslipRepositoryError extends Error {
  readonly code: PayslipRepositoryErrorCode;

  constructor(code: PayslipRepositoryErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "PayslipRepositoryError";
    this.code = code;
  }
}

export class PayslipRepository {
  readonly #client: SupabaseClient<Database>;
  readonly #userId: string;

  constructor(client: SupabaseClient<Database>, userId: string) {
    this.#client = client;
    this.#userId = uuidSchema.parse(userId);
  }

  /** New payslips start in `processing` with empty canonical data (PRD §6.6). */
  async create(input: CreatePayslipInput): Promise<Payslip> {
    const { data, error } = await this.#client
      .from("payslips")
      .insert({
        id: uuidSchema.parse(input.id),
        session_id: uuidSchema.parse(input.sessionId),
        user_id: this.#userId,
        original_filename: input.originalFilename,
        content_type: input.contentType,
        page_count: input.pageCount,
      })
      .select("*")
      .single();

    // Raised by the payslips_session_cap trigger, the only enforcement of the ten-payslip cap.
    if (error?.code === "P0001" && error.message === "session_full") {
      throw new PayslipRepositoryError("session_full", error);
    }
    if (error) throw new PayslipRepositoryError("query_failed", error);
    return mapPayslipRow(data);
  }

  async findDetailState(id: string): Promise<PayslipDetailState | null> {
    const { data, error } = await this.#client
      .from("payslips")
      .select(PAYSLIP_COLUMNS)
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    if (data === null) return null;

    const passes = readPassMetadata(data);
    return {
      ...mapPayslipState(data),
      editedFields: data.edited_fields,
      unreadableFields: passes.flatMap((pass) => pass.unreadableFields),
      lowConfidenceFields: lowConfidenceFields(passes),
      ungroundableFields: passes.flatMap((pass) => pass.ungroundableFields),
    };
  }

  /** Upload order, which Task 11's merge dialog relies on. */
  async listBySession(sessionId: string): Promise<PayslipState[]> {
    const { data, error } = await this.#client
      .from("payslips")
      .select(PAYSLIP_COLUMNS)
      .eq("session_id", uuidSchema.parse(sessionId))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data.map(mapPayslipState);
  }

  /** Source metadata stays internal to this focused read; payslip DTOs expose no storage fields. */
  async findSourceById(id: string): Promise<PayslipSourceMetadata | null> {
    const { data, error } = await this.#client
      .from("payslips")
      .select("content_type, original_filename")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    if (data === null) return null;

    const contentType = sourceContentTypeSchema.safeParse(data.content_type);
    if (!contentType.success) throw new PayslipRepositoryError("invalid_data");

    return { contentType: contentType.data, originalFilename: data.original_filename };
  }

  /** PRD §10.12 — the authenticated user's non-deleted payslips, newest first. */
  async listPage(options: ListPayslipsOptions): Promise<PayslipPage> {
    const from = (options.page - 1) * options.limit;
    const filtered = () => {
      const query = this.#client
        .from("payslips")
        .select(PAYSLIP_COLUMNS, { count: "exact" })
        .eq("user_id", this.#userId)
        .is("deleted_at", null);
      return (options.status === undefined ? query : query.eq("status", options.status)).order(
        "created_at",
        { ascending: false },
      );
    };

    const { data, error, count } = await filtered().range(from, from + options.limit - 1);

    // PostgREST refuses a range past the last row; the page is empty but the total is still owed.
    if (error?.code === "PGRST103") {
      const { error: countError, count: exactCount } = await filtered().range(0, 0);

      if (countError) throw new PayslipRepositoryError("query_failed", countError);
      return { items: [], total: exactCount ?? 0 };
    }
    if (error) throw new PayslipRepositoryError("query_failed", error);
    return { items: data.map(mapPayslipRow), total: count ?? 0 };
  }

  /** Returns null for a missing, deleted or foreign payslip: RLS and the filters are the check. */
  async update(id: string, input: UpdatePayslipInput): Promise<Payslip | null> {
    const update: PayslipUpdate = { updated_at: new Date().toISOString() };
    if (input.deletedAt !== undefined) update.deleted_at = input.deletedAt;

    const { data, error } = await this.#client
      .from("payslips")
      .update(update)
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .select(PAYSLIP_COLUMNS)
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === null ? null : mapPayslipRow(data);
  }

  async softDelete(id: string): Promise<Payslip | null> {
    return this.update(id, { deletedAt: new Date().toISOString() });
  }

  /**
   * Records one extraction pass (Task 05 D7) through `complete_extraction_pass`, which merges the
   * pass's fields, metadata and raw body into the row atomically, so the passes may land in either
   * order. The scalars pass applies only while the payslip is `processing` and moves it to
   * `review`; the tables pass applies only while its tables are `pending` on a payslip that has not
   * failed. `false` means the write was discarded: the payslip was deleted, reaped or failed while
   * the pass ran, and is never resurrected.
   */
  async completeExtractionPass(
    id: string,
    pass: ExtractionPass,
    result: CompletedExtraction,
  ): Promise<boolean> {
    const { data, error } = await this.#client.rpc("complete_extraction_pass", {
      p_payslip_id: uuidSchema.parse(id),
      p_pass: pass,
      p_fields: result.fields,
      p_metadata: result.metadata,
      p_raw: result.raw,
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
  }

  /**
   * The scalars pass failed (Task 04 D15): applies only to a live payslip still in `processing`.
   * The tables pass records its own outcome.
   */
  async failExtraction(id: string, reason: ExtractionFailureReason): Promise<boolean> {
    return this.#updateProcessing(id, { status: "failed", failure_reason: reason });
  }

  /**
   * Fails this user's `processing` payslips last touched before `cutoff` (Task 04 D3). The queue is
   * in memory, so a redeploy strands whatever was in flight; `provider_unavailable` is retryable.
   * Returns how many were failed.
   */
  async failStaleExtractions(cutoff: Date): Promise<number> {
    const { data, error } = await this.#client
      .from("payslips")
      .update({
        status: "failed",
        failure_reason: "provider_unavailable",
        // A lost payslip's tables are lost with it. If its tables pass had already landed, this
        // turns `ready` into `failed` on a payslip that is failing anyway, which is harmless.
        tables_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", this.#userId)
      .eq("status", "processing")
      .is("deleted_at", null)
      .lt("updated_at", cutoff.toISOString())
      .select("id");

    if (error) throw new PayslipRepositoryError("query_failed", error);

    // Task 05 D10: a payslip in `review` whose tables pass was lost. `updated_at`, as above: a
    // user edit during the pending window only delays the reap, and can never cause one.
    const tables = await this.#client
      .from("payslips")
      .update({ tables_status: "failed", updated_at: new Date().toISOString() })
      .eq("user_id", this.#userId)
      .eq("tables_status", "pending")
      .is("deleted_at", null)
      .lt("updated_at", cutoff.toISOString())
      .select("id");

    if (tables.error) throw new PayslipRepositoryError("query_failed", tables.error);
    return data.length + tables.data.length;
  }

  /**
   * The tables pass failed or was cancelled (Task 05 D9). Applies only while the tables are still
   * `pending` on a live payslip; `false` means discarded. No reason is stored: it is logged.
   */
  async failTablesExtraction(id: string): Promise<boolean> {
    const { data, error } = await this.#client
      .from("payslips")
      .update({ tables_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .eq("tables_status", "pending")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data !== null;
  }

  async #updateProcessing(id: string, update: PayslipUpdate): Promise<boolean> {
    const { data, error } = await this.#client
      .from("payslips")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .eq("status", "processing")
      .is("deleted_at", null)
      // Never select the raw column back.
      .select("id")
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data !== null;
  }
}

/**
 * Canonical values come from `canonical_data` only. The generated `numeric` columns exist for
 * list and export queries and are never read back here.
 */
export function mapPayslipRow(row: PayslipReadRow): Payslip {
  const passes = readPassMetadata(row);
  try {
    const fields = canonicalPayslipFieldsSchema.parse(row.canonical_data);
    return payslipSchema.parse({
      ...fields,
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      status: row.status,
      tablesStatus: row.tables_status,
      pageCount: row.page_count,
      // Always EUR (ROADMAP locked decision 7), so there is no column for it.
      currency: "EUR",
      // Computed on every read, never stored (Task 06 D1). Only a form the user can work on gets
      // warnings: tables landing before scalars would otherwise raise seven missing fields.
      warnings: WARNED_STATUSES.includes(row.status)
        ? computeWarnings({
            fields,
            unreadableFields: passes.flatMap((pass) => pass.unreadableFields),
            tablesStatus: tablesStatusSchema.parse(row.tables_status),
          })
        : [],
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      confirmedAt: normalizeNullableTimestamp(row.confirmed_at),
      deletedAt: normalizeNullableTimestamp(row.deleted_at),
    });
  } catch (error) {
    throw new PayslipRepositoryError("invalid_data", error);
  }
}

function mapPayslipState(row: PayslipReadRow): PayslipState {
  const payslip = mapPayslipRow(row);
  const failureReason = failureReasonSchema.safeParse(row.failure_reason);
  if (!failureReason.success) throw new PayslipRepositoryError("invalid_data", failureReason.error);
  return { payslip, failureReason: failureReason.data };
}

/** PostgREST returns `…T10:00:00.123456+00:00`, which `z.iso.datetime()` rejects. */
function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("invalid timestamp");
  return timestamp.toISOString();
}

function normalizeNullableTimestamp(value: string | null): string | null {
  return value === null ? null : normalizeTimestamp(value);
}

type PassMetadata = z.infer<typeof passMetadataSchema>;

/** Each pass's parsed metadata, scalars first; a pass not yet recorded is absent. */
function readPassMetadata(row: Pick<PayslipReadRow, "extraction_metadata">): PassMetadata[] {
  const metadata = extractionMetadataSchema.safeParse(row.extraction_metadata);
  if (!metadata.success) throw new PayslipRepositoryError("invalid_data", metadata.error);
  return [metadata.data?.scalars, metadata.data?.tables].filter(
    (pass): pass is PassMetadata => pass !== undefined,
  );
}
