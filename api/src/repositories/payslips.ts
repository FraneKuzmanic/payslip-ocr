import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalPayslipFieldsSchema,
  extractionFailureReasonSchema,
  payslipSchema,
  RETRYABLE_FAILURE_REASONS,
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
import { liveSignals } from "../validation/edited.js";
import { computeWarnings } from "../validation/warnings.js";

type PayslipRow = Database["public"]["Tables"]["payslips"]["Row"];

/** Every column a read needs. `raw_provider_result` is 0.2–1 MB per row and is never read here. */
type PayslipReadRow = Omit<PayslipRow, "raw_provider_result">;

/**
 * Every `payslips` column except `raw_provider_result` (Task 04 D11): a session poll of ten
 * payslips would otherwise move up to ~10 MB. Only `findRetainedResponses` reads the raw column.
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

/** A payslip plus the row state `Payslip` deliberately does not carry. */
export interface PayslipState {
  readonly payslip: Payslip;
  readonly failureReason: ExtractionFailureReason | null;
  readonly originalFilename: string;
}

/** The one read of the retained responses, for regions and for a PATCH's edited paths. */
export interface RetainedResponses {
  readonly status: string;
  readonly tablesStatus: string;
  readonly fields: CanonicalPayslipFields;
  /** `null` outside `review`/`confirmed` (Task 08 D7). */
  readonly rawProviderResult: unknown;
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

export interface MergePayslipsInput {
  readonly sessionId: string;
  readonly id: string;
  /** Page order; also stored as `merged_from`. */
  readonly order: readonly [string, string];
  readonly originalFilename: string;
  readonly pageCount: number;
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
    const state = mapPayslipState(data);
    const edited = data.edited_fields;
    // Task 09 D6: an edited value, or a cell whose row is gone, no longer carries machine signals.
    const live = (paths: readonly string[]) => liveSignals(paths, edited, state.payslip);
    return {
      ...state,
      editedFields: edited,
      unreadableFields: live(passes.flatMap((pass) => pass.unreadableFields)),
      lowConfidenceFields: live(lowConfidenceFields(passes)),
      ungroundableFields: live(passes.flatMap((pass) => pass.ungroundableFields)),
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

  /**
   * The retained pass bodies, for a source-region projection (Task 08 D7) and for a PATCH's edited
   * paths (Task 09 D4): the only read of `raw_provider_result`. A payslip without a readable form
   * has nothing to project or edit, so its bodies are withheld here rather than filtered by the
   * caller.
   */
  async findRetainedResponses(id: string): Promise<RetainedResponses | null> {
    const { data, error } = await this.#client
      .from("payslips")
      .select("status, tables_status, canonical_data, raw_provider_result")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    if (data === null) return null;

    const fields = canonicalPayslipFieldsSchema.safeParse(data.canonical_data);
    if (!fields.success) throw new PayslipRepositoryError("invalid_data", fields.error);
    return {
      status: data.status,
      tablesStatus: data.tables_status,
      fields: fields.data,
      rawProviderResult: WARNED_STATUSES.includes(data.status) ? data.raw_provider_result : null,
    };
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

  /**
   * PRD §10.6: merges the changed top-level keys and stores the edited paths, in one statement
   * through `update_payslip_fields` (Task 09 D2). `false`: missing, foreign, deleted, not editable,
   * or a table key while the tables pass is pending (D10).
   */
  async updateFields(
    id: string,
    fields: Partial<CanonicalPayslipFields>,
    editedFields: readonly string[],
  ): Promise<boolean> {
    const { data, error } = await this.#client.rpc("update_payslip_fields", {
      p_payslip_id: uuidSchema.parse(id),
      p_fields: fields as Json,
      p_edited_fields: [...editedFields],
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
  }

  /**
   * PRD §10.7 through `confirm_payslip`: `review` → `confirmed` unless the tables are pending, and
   * an already-confirmed payslip keeps its first `confirmedAt`. `null`: not confirmable now, or
   * missing, foreign or deleted.
   */
  async confirm(id: string): Promise<string | null> {
    const { data, error } = await this.#client.rpc("confirm_payslip", {
      p_payslip_id: uuidSchema.parse(id),
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    // The generated type says `string`, but a plpgsql `timestamptz` return is `null` when unset.
    return normalizeNullableTimestamp(data as string | null);
  }

  /** Returns false for a missing, deleted or foreign payslip; `soft_delete_payslip` is the check. */
  async softDelete(id: string): Promise<boolean> {
    const { data, error } = await this.#client.rpc("soft_delete_payslip", {
      p_payslip_id: uuidSchema.parse(id),
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
  }

  /**
   * Task 07 D8: resets a retryable failure to a fresh extraction. One conditional update, so of two
   * concurrent retries only one matches, and only one analysis is paid for. The tables pass writes
   * only while `pending`, and a tables result that landed before the scalars pass failed is cleared
   * with the rest. False: missing, foreign, deleted, or not retryable now.
   */
  async beginRetry(id: string): Promise<boolean> {
    const { data, error } = await this.#client.rpc("begin_payslip_retry", {
      p_payslip_id: uuidSchema.parse(id),
      p_retryable_reasons: [...RETRYABLE_FAILURE_REASONS],
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
  }

  /**
   * Plan 11 D8: soft-deletes both originals and inserts the merged payslip, in one transaction
   * through `merge_payslips`. The merged row is `processing` with pending tables, and takes the
   * earlier original's `created_at`. False: either original is missing, foreign, deleted, in
   * another session, or still extracting.
   */
  async merge(input: MergePayslipsInput): Promise<boolean> {
    const { data, error } = await this.#client.rpc("merge_payslips", {
      p_session_id: uuidSchema.parse(input.sessionId),
      p_new_id: uuidSchema.parse(input.id),
      p_order: input.order.map((id) => uuidSchema.parse(id)),
      p_original_filename: input.originalFilename,
      p_page_count: input.pageCount,
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
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
    const { data, error } = await this.#client.rpc("fail_payslip_extraction", {
      p_payslip_id: uuidSchema.parse(id),
      p_reason: reason,
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
  }

  /**
   * Fails this user's payslips last touched before `cutoff` (Task 04 D3, Task 05 D10): those still
   * `processing`, and those in `review` whose tables pass never landed. The queue is in memory, so
   * a redeploy strands whatever was in flight; `provider_unavailable` is retryable. Returns how many
   * rows were failed.
   */
  async failStaleExtractions(cutoff: Date): Promise<number> {
    const { data, error } = await this.#client.rpc("fail_stale_payslip_extractions", {
      p_cutoff: cutoff.toISOString(),
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data;
  }

  /**
   * The tables pass failed or was cancelled (Task 05 D9). Applies only while the tables are still
   * `pending` on a live payslip; `false` means discarded. No reason is stored: it is logged.
   */
  async failTablesExtraction(id: string): Promise<boolean> {
    const { data, error } = await this.#client.rpc("fail_payslip_tables", {
      p_payslip_id: uuidSchema.parse(id),
    });

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === true;
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
    // Task 09 D6: no phantom `unparseable_*` for a value the user edited or a row they removed.
    const unreadableFields = liveSignals(
      passes.flatMap((pass) => pass.unreadableFields),
      row.edited_fields,
      fields,
    );
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
            unreadableFields,
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
  return { payslip, failureReason: failureReason.data, originalFilename: row.original_filename };
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
