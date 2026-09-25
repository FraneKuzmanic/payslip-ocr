import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { supabase } from "../lib/supabase";
import {
  ApiError,
  getHealth,
  getPayslipSource,
  getSessionDetail,
  retryPayslip,
  uploadPayslip,
} from "./client";

type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type SignOutResult = Awaited<ReturnType<typeof supabase.auth.signOut>>;

let getSession: MockInstance<typeof supabase.auth.getSession>;
let signOut: MockInstance<typeof supabase.auth.signOut>;

/** The client only ever reads `access_token`, so a fuller session object would be noise. */
function sessionResult(accessToken: string | null): SessionResult {
  const session = accessToken === null ? null : { access_token: accessToken };
  return { data: { session }, error: null } as SessionResult;
}

function respondWith(status: number, body: unknown) {
  // Typed with fetch's own parameters so the recorded call can be inspected below.
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function sentHeaders(fetchMock: ReturnType<typeof respondWith>): Headers {
  return fetchMock.mock.calls[0]?.[1]?.headers as Headers;
}

beforeEach(() => {
  // Spies are created per test: afterEach restores them, and a restored spy no longer
  // intercepts, so re-mocking a module-scope spy would silently do nothing.
  getSession = vi.spyOn(supabase.auth, "getSession");
  signOut = vi.spyOn(supabase.auth, "signOut");
  signOut.mockResolvedValue({ error: null } as SignOutResult);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the API client", () => {
  it("attaches the access token when a session exists", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const fetchMock = respondWith(200, { status: "ok", uptimeSeconds: 1 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual({ status: "ok", uptimeSeconds: 1 });
    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer token-abc");
  });

  it("sends no Authorization header when signed out", async () => {
    getSession.mockResolvedValue(sessionResult(null));
    const fetchMock = respondWith(200, { status: "ok", uptimeSeconds: 1 });
    vi.stubGlobal("fetch", fetchMock);

    await getHealth();

    expect(sentHeaders(fetchMock).get("Authorization")).toBeNull();
  });

  it("signs out exactly once on a 401 so ProtectedRoute can redirect", async () => {
    getSession.mockResolvedValue(sessionResult("stale-token"));
    vi.stubGlobal("fetch", respondWith(401, { error: { code: "unauthorized" } }));

    await expect(getHealth()).rejects.toThrow(ApiError);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("does not sign out on other failures", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    vi.stubGlobal("fetch", respondWith(404, { error: { code: "not_found" } }));

    await expect(getHealth()).rejects.toThrow(ApiError);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("parses the signed source response for a payslip", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const source = {
      url: "https://example.test/signed",
      contentType: "application/pdf",
      originalFilename: "lipanj.pdf",
      expiresAt: "2026-09-21T10:05:00.000Z",
    };
    const fetchMock = respondWith(200, source);
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPayslipSource("payslip/id")).resolves.toEqual(source);
    expect(fetchMock).toHaveBeenCalledWith("/api/payslips/payslip%2Fid/source", expect.any(Object));
    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer token-abc");
  });

  it("uploads one file as the single multipart part to the encoded session path", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const created = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionId: "22222222-2222-4222-8222-222222222222",
      status: "processing",
      createdAt: "2026-09-25T10:00:00.000Z",
    };
    const fetchMock = respondWith(201, created);
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["bytes"], "platna.jpg", { type: "image/jpeg" });

    await expect(uploadPayslip("session/id", file)).resolves.toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/sessions/session%2Fid/payslips");
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect([...body.keys()]).toEqual(["file"]);
    expect((body.get("file") as File).name).toBe("platna.jpg");
  });

  it("passes the abort signal through when reading a session", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const fetchMock = respondWith(200, {
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-09-25T10:00:00.000Z",
      payslips: [],
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await getSessionDetail("22222222-2222-4222-8222-222222222222", controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("surfaces a refused retry as an ApiError carrying retry_not_allowed", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    vi.stubGlobal("fetch", respondWith(409, { error: { code: "retry_not_allowed" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(retryPayslip("id")).rejects.toMatchObject({
      status: 409,
      code: "retry_not_allowed",
    });
  });

  it("says so in the console when a response does not match its shape, then rethrows", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    vi.stubGlobal("fetch", respondWith(200, { url: "not a url" }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getPayslipSource("id")).rejects.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GET /api/payslips/:id/source"),
      expect.anything(),
    );
  });

  it("keeps a stable server error code and tolerates malformed errors", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    vi.stubGlobal("fetch", respondWith(415, { error: { code: "unsupported_media_type" } }));

    await expect(getHealth()).rejects.toMatchObject({
      status: 415,
      code: "unsupported_media_type",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not json", { status: 500 }))),
    );
    await expect(getHealth()).rejects.toMatchObject({ status: 500, code: undefined });
  });
});
