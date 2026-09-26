import {
  HEALTH_PATH,
  apiErrorResponseSchema,
  confirmPayslipResponseSchema,
  createPayslipResponseSchema,
  createSessionResponseSchema,
  payslipDetailResponseSchema,
  retryPayslipResponseSchema,
  sessionDetailResponseSchema,
  sourceDocumentResponseSchema,
  sourceRegionsResponseSchema,
  type ConfirmPayslipResponse,
  type CreatePayslipResponse,
  type CreateSessionResponse,
  type HealthResponse,
  type PayslipDetailResponse,
  type RetryPayslipResponse,
  type SessionDetailResponse,
  type SourceDocumentResponse,
  type SourceRegionsResponse,
  type UpdatePayslipRequest,
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

export async function createSession(): Promise<CreateSessionResponse> {
  const response = await request("/api/sessions", { method: "POST" });
  return await parseResponse(createSessionResponseSchema, response, "POST /api/sessions");
}

export async function uploadPayslip(sessionId: string, file: File): Promise<CreatePayslipResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await request(`/api/sessions/${encodeURIComponent(sessionId)}/payslips`, {
    method: "POST",
    body: formData,
  });
  return await parseResponse(
    createPayslipResponseSchema,
    response,
    "POST /api/sessions/:id/payslips",
  );
}

/** Not `getSession`: that would read as `supabase.auth.getSession`, which `request()` calls. */
export async function getSessionDetail(
  id: string,
  signal?: AbortSignal,
): Promise<SessionDetailResponse> {
  const response = await request(`/api/sessions/${encodeURIComponent(id)}`, { signal });
  return await parseResponse(sessionDetailResponseSchema, response, "GET /api/sessions/:id");
}

export async function getPayslipDetail(
  id: string,
  signal?: AbortSignal,
): Promise<PayslipDetailResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}`, { signal });
  return await parseResponse(payslipDetailResponseSchema, response, "GET /api/payslips/:id");
}

export async function getPayslipRegions(
  id: string,
  signal?: AbortSignal,
): Promise<SourceRegionsResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/regions`, { signal });
  return await parseResponse(
    sourceRegionsResponseSchema,
    response,
    "GET /api/payslips/:id/regions",
  );
}

export async function retryPayslip(id: string): Promise<RetryPayslipResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
  return await parseResponse(retryPayslipResponseSchema, response, "POST /api/payslips/:id/retry");
}

/** PRD §10.6: saves the changed fields and answers with the recomputed detail. */
export async function updatePayslip(
  id: string,
  body: UpdatePayslipRequest,
): Promise<PayslipDetailResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await parseResponse(payslipDetailResponseSchema, response, "PATCH /api/payslips/:id");
}

/** PRD §10.7: idempotent, so a second confirm answers with the first `confirmedAt`. */
export async function confirmPayslip(id: string): Promise<ConfirmPayslipResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
  });
  return await parseResponse(
    confirmPayslipResponseSchema,
    response,
    "POST /api/payslips/:id/confirm",
  );
}

export async function getPayslipSource(id: string): Promise<SourceDocumentResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/source`);
  return await parseResponse(
    sourceDocumentResponseSchema,
    response,
    "GET /api/payslips/:id/source",
  );
}
