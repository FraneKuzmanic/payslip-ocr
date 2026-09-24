import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalPayslipFieldsSchema,
  extractionFailureReasonSchema,
  payslipSchema,
  payslipWarningSchema,
  sourceContentTypeSchema,
  type ExtractionFailureReason,
  type Payslip,
  type PayslipStatus,
  type SourceContentType,
} from "@payslip/shared";
import type { Database } from "../database.types.js";

type PayslipRow = Database["public"]["Tables"]["payslips"]["Row"];
type PayslipUpdate = Database["public"]["Tables"]["payslips"]["Update"];

const uuidSchema = z.uuid();
const warningsSchema = z.array(payslipWarningSchema);
const failureReasonSchema = extractionFailureReasonSchema.nullable();

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
      .select("*")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    if (data === null) return null;
    return { ...mapPayslipState(data), editedFields: data.edited_fields };
  }

  /** Upload order, which Task 11's merge dialog relies on. */
  async listBySession(sessionId: string): Promise<PayslipState[]> {
    const { data, error } = await this.#client
      .from("payslips")
      .select("*")
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
        .select("*", { count: "exact" })
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
      .select("*")
      .maybeSingle();

    if (error) throw new PayslipRepositoryError("query_failed", error);
    return data === null ? null : mapPayslipRow(data);
  }

  async softDelete(id: string): Promise<Payslip | null> {
    return this.update(id, { deletedAt: new Date().toISOString() });
  }
}

/**
 * Canonical values come from `canonical_data` only. The generated `numeric` columns exist for
 * list and export queries and are never read back here.
 */
export function mapPayslipRow(row: PayslipRow): Payslip {
  try {
    return payslipSchema.parse({
      ...canonicalPayslipFieldsSchema.parse(row.canonical_data),
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      status: row.status,
      pageCount: row.page_count,
      // Always EUR (ROADMAP locked decision 7), so there is no column for it.
      currency: "EUR",
      warnings: warningsSchema.parse(row.warnings),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      confirmedAt: normalizeNullableTimestamp(row.confirmed_at),
      deletedAt: normalizeNullableTimestamp(row.deleted_at),
    });
  } catch (error) {
    throw new PayslipRepositoryError("invalid_data", error);
  }
}

function mapPayslipState(row: PayslipRow): PayslipState {
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
