import { z } from "zod";
import { createClient, type JwtPayload, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import type { Database } from "../database.types.js";

const uuidSchema = z.uuid();

/**
 * Proof that a request carries a verified user identity, plus the Supabase client scoped to
 * that user. Handlers receive this as an argument rather than reading it off the request, so a
 * route is structurally incapable of using a user id it has not proven (PRD §9.1).
 */
export interface AuthContext {
  readonly userId: string;
  readonly client: SupabaseClient<Database>;
}

export interface Authenticator {
  /** Returns null for any token that is absent, malformed, expired or not a signed-in user. */
  authenticate(accessToken: string): Promise<AuthContext | null>;
}

/**
 * The only claims this application trusts. `getClaims` has already verified the signature and
 * `exp` by the time this runs, so the remaining questions are who the token is for and whether
 * it belongs to a signed-in user at all.
 *
 * Exported so the decision can be unit-tested directly, without a Supabase client anywhere near
 * the test.
 */
export function userIdFromClaims(claims: JwtPayload): string | null {
  // An `anon` token is the publishable key itself. It authenticates nobody, and the database
  // grants it nothing, but it must never be mistaken for a session.
  if (claims.role !== "authenticated") return null;
  return uuidSchema.safeParse(claims.sub).success ? claims.sub : null;
}

/**
 * The hosted project signs with ES256, so `getClaims` verifies in-process against a JWKS the
 * client caches — no network round trip per request, which is why the verifier is long-lived and
 * shared while the user-scoped client below is per-request.
 */
export function createSupabaseAuthenticator(): Authenticator {
  const verifier = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async authenticate(accessToken: string): Promise<AuthContext | null> {
      const { data, error } = await verifier.auth.getClaims(accessToken);
      if (error || data === null) return null;

      const userId = userIdFromClaims(data.claims);
      if (userId === null) return null;

      return { userId, client: createUserClient(accessToken) };
    },
  };
}

/**
 * Carries the caller's own token, so PostgREST and Storage evaluate every query under that
 * user's RLS context. This is the client the repositories expect — the
 * secret key bypasses RLS and is never used on a request path.
 */
function createUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
