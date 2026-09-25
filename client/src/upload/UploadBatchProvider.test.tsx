import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { CreatePayslipResponse } from "@payslip/shared";
import { createSession, uploadPayslip } from "../api/client";
import { supabase } from "../lib/supabase";
import type { StartBatchResult, UploadBatchContextValue } from "./UploadBatchContext";
import { UploadBatchProvider } from "./UploadBatchProvider";
import { useUploadBatch } from "./useUploadBatch";

vi.mock("../api/client", () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(status: number, code?: string) {
      super(`Request failed with status ${status}`);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, createSession: vi.fn(), uploadPayslip: vi.fn() };
});

const { ApiError } = await import("../api/client");

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

type RefreshResult = Awaited<ReturnType<typeof supabase.auth.refreshSession>>;

let refreshSession: MockInstance<typeof supabase.auth.refreshSession>;
let batch: UploadBatchContextValue;

function Harness() {
  batch = useUploadBatch();
  return null;
}

function renderProvider() {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<UploadBatchProvider />}>
          <Route index element={<Harness />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function created(id: string): CreatePayslipResponse {
  return { id, sessionId: SESSION_ID, status: "processing", createdAt: "2026-09-25T10:00:00.000Z" };
}

function file(name: string): File {
  return new File(["bytes"], name, { type: "image/jpeg" });
}

const states = () => batch.itemsFor(SESSION_ID).map((item) => item.state);

/** Whether a page unload would be held back by the browser's "Leave site?" dialog. */
function unload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Lets every pending promise callback and the resulting React update run. */
const flush = () => act(async () => {});

beforeEach(() => {
  refreshSession = vi
    .spyOn(supabase.auth, "refreshSession")
    .mockResolvedValue({ data: {}, error: null } as RefreshResult);
  vi.mocked(createSession).mockResolvedValue({
    id: SESSION_ID,
    createdAt: "2026-09-25T10:00:00.000Z",
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(uploadPayslip).mockReset();
  vi.mocked(createSession).mockReset();
});

describe("UploadBatchProvider", () => {
  it("throws a clear error outside the provider", () => {
    expect(() => render(<Harness />)).toThrow(
      "useUploadBatch must be used inside UploadBatchProvider",
    );
  });

  it("refreshes the auth session once, before creating the session", async () => {
    vi.mocked(uploadPayslip).mockResolvedValue(created("p1"));
    renderProvider();

    await act(async () => {
      await batch.startBatch([file("a.jpg")]);
    });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(refreshSession.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createSession).mock.invocationCallOrder[0]!,
    );
  });

  it("uploads one file at a time, in order, and resolves at the first 201", async () => {
    const uploads = [deferred<CreatePayslipResponse>(), deferred<CreatePayslipResponse>()];
    vi.mocked(uploadPayslip)
      .mockReturnValueOnce(uploads[0]!.promise)
      .mockReturnValueOnce(uploads[1]!.promise);
    renderProvider();

    let result: StartBatchResult | undefined;
    await act(async () => {
      void batch.startBatch([file("a.jpg"), file("b.jpg")]).then((value) => (result = value));
    });

    expect(vi.mocked(uploadPayslip).mock.calls.map(([, f]) => f.name)).toEqual(["a.jpg"]);
    expect(states()).toEqual(["uploading", "waiting"]);
    expect(result).toBeUndefined();

    uploads[0]!.resolve(created("p1"));
    await flush();

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID });
    expect(vi.mocked(uploadPayslip).mock.calls.map(([, f]) => f.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(batch.itemsFor(SESSION_ID)[0]).toMatchObject({ state: "uploaded", payslipId: "p1" });
    expect(states()).toEqual(["uploaded", "uploading"]);
    expect(console.info).toHaveBeenCalledWith("[upload] first payslip created", {
      ms: expect.any(Number),
    });

    uploads[1]!.resolve(created("p2"));
    await flush();
    expect(states()).toEqual(["uploaded", "uploaded"]);
  });

  it("marks a refused file with its code and carries on with the next", async () => {
    vi.mocked(uploadPayslip)
      .mockResolvedValueOnce(created("p1"))
      .mockRejectedValueOnce(new ApiError(415, "unsupported_media_type"))
      .mockResolvedValueOnce(created("p3"));
    renderProvider();

    await act(async () => {
      await batch.startBatch([file("a.jpg"), file("b.txt"), file("c.jpg")]);
    });
    await flush();

    expect(uploadPayslip).toHaveBeenCalledTimes(3);
    expect(batch.itemsFor(SESSION_ID)[1]).toMatchObject({
      state: "rejected",
      errorCode: "unsupported_media_type",
    });
    expect(states()).toEqual(["uploaded", "rejected", "uploaded"]);
  });

  it("resolves with each file's code when every file is refused", async () => {
    vi.mocked(uploadPayslip)
      .mockRejectedValueOnce(new ApiError(422, "pdf_encrypted"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderProvider();

    let result: StartBatchResult | undefined;
    await act(async () => {
      result = await batch.startBatch([file("a.pdf"), file("b.jpg")]);
    });

    expect(result).toEqual({
      ok: false,
      errors: new Map([
        [0, "pdf_encrypted"],
        [1, "network"],
      ]),
    });
  });

  it("resolves with a session error when the session cannot be created", async () => {
    vi.mocked(createSession).mockRejectedValue(new ApiError(500));
    renderProvider();

    let result: StartBatchResult | undefined;
    await act(async () => {
      result = await batch.startBatch([file("a.jpg")]);
    });

    expect(result).toEqual({ ok: false, errors: "session" });
    expect(uploadPayslip).not.toHaveBeenCalled();
  });

  it("stops the batch on a 401 and attempts nothing after it", async () => {
    vi.mocked(uploadPayslip)
      .mockResolvedValueOnce(created("p1"))
      .mockRejectedValueOnce(new ApiError(401));
    renderProvider();

    await act(async () => {
      await batch.startBatch([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    });
    await flush();

    expect(uploadPayslip).toHaveBeenCalledTimes(2);
    expect(batch.itemsFor(SESSION_ID).map((item) => [item.state, item.errorCode])).toEqual([
      ["uploaded", undefined],
      ["rejected", "network"],
      ["rejected", "network"],
    ]);
  });

  it("guards unloading only while files are unsent", async () => {
    const upload = deferred<CreatePayslipResponse>();
    vi.mocked(uploadPayslip).mockReturnValueOnce(upload.promise);
    renderProvider();

    expect(unload()).toBe(false);
    await act(async () => {
      void batch.startBatch([file("a.jpg")]);
    });
    expect(unload()).toBe(true);

    upload.resolve(created("p1"));
    await flush();
    expect(unload()).toBe(false);
  });

  it("dismisses one item", async () => {
    vi.mocked(uploadPayslip).mockRejectedValue(new ApiError(413, "file_too_large"));
    renderProvider();

    await act(async () => {
      await batch.startBatch([file("a.jpg"), file("b.jpg")]);
    });
    const [first] = batch.itemsFor(SESSION_ID);
    act(() => batch.dismiss(SESSION_ID, first!.localId));

    expect(batch.itemsFor(SESSION_ID).map((item) => item.name)).toEqual(["b.jpg"]);
  });
});
