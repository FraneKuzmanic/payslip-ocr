import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionSchema, type Session } from "@payslip/shared";
import type { Database } from "../database.types.js";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];

const uuidSchema = z.uuid();

export type SessionRepositoryErrorCode = "invalid_data" | "query_failed";

export class SessionRepositoryError extends Error {
  readonly code: SessionRepositoryErrorCode;

  constructor(code: SessionRepositoryErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "SessionRepositoryError";
    this.code = code;
  }
}

export class SessionRepository {
  readonly #client: SupabaseClient<Database>;
  readonly #userId: string;

  constructor(client: SupabaseClient<Database>, userId: string) {
    this.#client = client;
    this.#userId = uuidSchema.parse(userId);
  }

  async create(): Promise<Session> {
    const { data, error } = await this.#client
      .from("sessions")
      .insert({ user_id: this.#userId })
      .select("*")
      .single();

    if (error) throw new SessionRepositoryError("query_failed", error);
    return mapSessionRow(data);
  }

  async findById(id: string): Promise<Session | null> {
    const { data, error } = await this.#client
      .from("sessions")
      .select("*")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new SessionRepositoryError("query_failed", error);
    return data === null ? null : mapSessionRow(data);
  }
}

export function mapSessionRow(row: SessionRow): Session {
  try {
    return sessionSchema.parse({
      id: row.id,
      userId: row.user_id,
      createdAt: normalizeTimestamp(row.created_at),
      deletedAt: row.deleted_at === null ? null : normalizeTimestamp(row.deleted_at),
    });
  } catch (error) {
    throw new SessionRepositoryError("invalid_data", error);
  }
}

/** PostgREST returns `…T10:00:00.123456+00:00`, which `z.iso.datetime()` rejects. */
function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("invalid timestamp");
  return timestamp.toISOString();
}
