import {
  HEALTH_PATH,
  apiErrorResponseSchema,
  sourceDocumentResponseSchema,
  type HealthResponse,
  type SourceDocumentResponse,
} from "@payslip/shared";
import { supabase } from "../lib/supabase";

// Empty by default so a relative path keeps working under Vite's dev proxy. Only needed when the
// client and API are deployed as separate origins, which have no such proxy in production.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Every API call goes through here so the bearer token is attached in exactly one place.
 *
 * `getSession()` transparently refreshes an expiring token, so there is no hand-rolled refresh
 * logic to get wrong.
 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);

  if (data.session) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }

  const method = init.method ?? "GET";
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401) {
    // The token is gone or no longer valid. Signing out fires onAuthStateChange, which clears
    // the session and lets ProtectedRoute do the redirect — no navigation logic lives here.
    // Signing out an already-signed-out client is a no-op, so this cannot loop.
    console.error(`[api] ${method} ${path} → 401; signing out`);
    await supabase.auth.signOut();
    throw new ApiError(401);
  }

  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .then((value: unknown) => apiErrorResponseSchema.safeParse(value))
      .catch(() => null);

    const code = body?.success ? body.data.error.code : undefined;
    console.error(
      `[api] ${method} ${path} → ${response.status}`,
      code ?? "(no error code in body)",
    );
    throw new ApiError(response.status, code);
  }

  return response;
}

/** Structural rather than a Zod type: the client deliberately has no direct `zod` dependency. */
interface ResponseParser<T> {
  parse: (value: unknown) => T;
}

/**
 * Parses a response body and, when it does not match, says so in the console before rethrowing.
 *
 * The rethrow is what callers already handled, so nothing the user sees changes — the screen keeps
 * its translated copy. The console line is the part that was missing: every call site swallowed
 * this error with a bare `catch {}`, so the 2026-08-26 contract skew produced a generic error
 * screen and a completely empty console, and took hours to identify from the outside.
 */
async function parseResponse<T>(
  schema: ResponseParser<T>,
  response: Response,
  label: string,
): Promise<T> {
  const body: unknown = await response.json();
  try {
    return schema.parse(body);
  } catch (error) {
    console.error(
      `[api] ${label}: the response did not match the expected shape. ` +
        `If this bundle is older than the API, reload the page.`,
      error,
    );
    throw error;
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await request(HEALTH_PATH);
  return (await response.json()) as HealthResponse;
}

export async function getPayslipSource(id: string): Promise<SourceDocumentResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/source`);
  return await parseResponse(
    sourceDocumentResponseSchema,
    response,
    "GET /api/payslips/:id/source",
  );
}
