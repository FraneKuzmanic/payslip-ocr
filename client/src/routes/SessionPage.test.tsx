import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipSummary, SessionDetailResponse } from "@payslip/shared";
import { getSessionDetail, retryPayslip } from "../api/client";
import i18n from "../i18n";
import type { BatchItem } from "../upload/UploadBatchContext";
import { POLL_INTERVAL_MS, SessionPage } from "./SessionPage";

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
  return { ApiError, getSessionDetail: vi.fn(), retryPayslip: vi.fn() };
});

let batchItems: readonly BatchItem[] = [];
const dismiss = vi.fn();

vi.mock("../review/PayslipPreview", () => ({
  PayslipPreview: ({ payslipId, tablesStatus }: { payslipId: string; tablesStatus: string }) => (
    <p data-testid="preview">{`${payslipId} ${tablesStatus}`}</p>
  ),
}));

vi.mock("../upload/useUploadBatch", () => ({
  useUploadBatch: () => ({ startBatch: vi.fn(), itemsFor: () => batchItems, dismiss }),
}));

const { ApiError } = await import("../api/client");

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const mockedDetail = vi.mocked(getSessionDetail);
const mockedRetry = vi.mocked(retryPayslip);

function summary(id: string, overrides: Partial<PayslipSummary> = {}): PayslipSummary {
  return {
    id,
    status: "processing",
    tablesStatus: "pending",
    period: null,
    employeeName: null,
    pageCount: 1,
    failureReason: null,
    warningCount: 0,
    originalFilename: `${id}.jpg`,
    ...overrides,
  };
}

function session(...payslips: PayslipSummary[]): SessionDetailResponse {
  return { id: SESSION_ID, createdAt: "2026-09-25T10:00:00.000Z", payslips };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.search}</p>;
}

function renderPage(search = "") {
  render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}${search}`]}>
      <Routes>
        <Route
          path="/sessions/:sessionId"
          element={
            <>
              <SessionPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Runs pending promise callbacks and the React updates they cause. */
const flush = () => act(async () => {});
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  });
const rows = () => within(screen.getByRole("list")).getAllByRole("listitem");

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  batchItems = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockedDetail.mockReset();
  mockedRetry.mockReset();
  dismiss.mockReset();
});

describe("SessionPage", () => {
  it("lists payslips in server order with position, filename, status and details", async () => {
    mockedDetail.mockResolvedValue(
      session(
        summary("first", {
          status: "review",
          tablesStatus: "pending",
          employeeName: "Ana Horvat",
          period: "2025-03",
        }),
        summary("second", { status: "failed", failureReason: "unreadable_document" }),
      ),
    );
    renderPage();
    await flush();

    const [first, second] = rows();
    expect(first).toHaveTextContent("Payslip 1");
    expect(first).toHaveTextContent("first.jpg");
    expect(first).toHaveTextContent("Ana Horvat · 2025-03");
    expect(first).toHaveTextContent("Ready to review");
    expect(first).toHaveTextContent("Line items still loading");
    expect(second).toHaveTextContent("Payslip 2");
    expect(second).toHaveTextContent("Failed");
    expect(second).toHaveTextContent("The document could not be read. Try a sharper photo.");
    expect(within(second!).queryByRole("button")).toBeNull();
    expect(mockedDetail).toHaveBeenCalledWith(SESSION_ID, expect.any(AbortSignal));
  });

  it("keeps polling while tables are pending and stops once everything is settled", async () => {
    mockedDetail
      .mockResolvedValueOnce(session(summary("a", { status: "review", tablesStatus: "pending" })))
      .mockResolvedValue(session(summary("a", { status: "review", tablesStatus: "ready" })));
    renderPage();
    await flush();
    expect(mockedDetail).toHaveBeenCalledTimes(1);

    await tick();
    expect(mockedDetail).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Line items ready")).toBeInTheDocument();

    await tick();
    await tick();
    expect(mockedDetail).toHaveBeenCalledTimes(2);
  });

  it("has no client-side timeout: a payslip still processing after five minutes is still polled", async () => {
    mockedDetail.mockResolvedValue(session(summary("a")));
    renderPage();
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mockedDetail.mock.calls.length).toBeGreaterThan(100);
    expect(screen.getByText("Reading the payslip")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("appends unsent and rejected batch items after the server rows, each uploaded one once", async () => {
    batchItems = [
      { localId: "l1", name: "a.jpg", state: "uploaded", payslipId: "a" },
      { localId: "l2", name: "b.pdf", state: "rejected", errorCode: "pdf_too_many_pages" },
      { localId: "l3", name: "c.jpg", state: "waiting" },
    ];
    mockedDetail.mockResolvedValue(session(summary("a")));
    renderPage();
    await flush();

    const [first, second, third] = rows();
    expect(rows()).toHaveLength(3);
    expect(first).toHaveTextContent("a.jpg");
    expect(second).toHaveTextContent("b.pdf");
    expect(second).toHaveTextContent(
      "This PDF has too many pages. Upload a document of up to 10 pages.",
    );
    expect(third).toHaveTextContent("c.jpg");
    expect(third).toHaveTextContent("Waiting to upload");

    fireEvent.click(within(second!).getByRole("button", { name: "Dismiss b.pdf" }));
    expect(dismiss).toHaveBeenCalledWith(SESSION_ID, "l2");
  });

  it("keeps polling while a batch item is unsent, even when the server rows are settled", async () => {
    batchItems = [{ localId: "l1", name: "b.jpg", state: "uploading" }];
    mockedDetail.mockResolvedValue(session(summary("a", { status: "failed" })));
    renderPage();
    await flush();

    await tick();
    expect(mockedDetail).toHaveBeenCalledTimes(2);
  });

  it("retries only a retryable failure, and shows it processing again", async () => {
    mockedDetail.mockResolvedValue(
      session(
        summary("a", { status: "failed", failureReason: "provider_unavailable" }),
        summary("b", { status: "failed", failureReason: "provider_rejected" }),
      ),
    );
    mockedRetry.mockResolvedValue({ id: "a", status: "processing" });
    renderPage();
    await flush();
    const [first, second] = rows();
    expect(within(second!).queryByRole("button", { name: "Try again" })).toBeNull();

    mockedDetail.mockResolvedValue(
      session(summary("a"), summary("b", { status: "failed", failureReason: "provider_rejected" })),
    );
    fireEvent.click(within(first!).getByRole("button", { name: "Try again" }));
    await flush();

    expect(mockedRetry).toHaveBeenCalledWith("a");
    expect(rows()[0]).toHaveTextContent("Reading the payslip");
  });

  it("marks the retry button busy while its request is in flight", async () => {
    mockedDetail.mockResolvedValue(
      session(summary("a", { status: "failed", failureReason: "provider_unavailable" })),
    );
    mockedRetry.mockReturnValue(new Promise(() => {}));
    renderPage();
    await flush();

    const button = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(mockedRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps focus on the row once a retry replaces its button", async () => {
    mockedDetail.mockResolvedValue(
      session(summary("a", { status: "failed", failureReason: "provider_unavailable" })),
    );
    mockedRetry.mockResolvedValue({ id: "a", status: "processing" });
    renderPage();
    await flush();

    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);
    await flush();

    expect(document.activeElement).toBe(rows()[0]);
  });

  it("on a 409 retry refetches without an error, since another retry already won", async () => {
    mockedDetail.mockResolvedValue(
      session(summary("a", { status: "failed", failureReason: "provider_unavailable" })),
    );
    mockedRetry.mockRejectedValue(new ApiError(409, "retry_not_allowed"));
    renderPage();
    await flush();

    mockedDetail.mockResolvedValue(session(summary("a")));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();

    expect(mockedDetail).toHaveBeenCalledTimes(2);
    expect(rows()[0]).toHaveTextContent("Reading the payslip");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the retry could not start on any other failure, on that row only", async () => {
    mockedDetail.mockResolvedValue(
      session(
        summary("a", { status: "failed", failureReason: "provider_unavailable" }),
        summary("b", { status: "review", tablesStatus: "ready" }),
      ),
    );
    mockedRetry.mockRejectedValue(new ApiError(500));
    renderPage();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();

    const [first, second] = rows();
    expect(within(first!).getByRole("alert")).toHaveTextContent(
      "The retry could not be started. Check your connection and try again.",
    );
    expect(within(second!).queryByRole("alert")).toBeNull();
    expect(within(first!).getByRole("button", { name: "Try again" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("says the session does not exist on a 404, with a way back", async () => {
    mockedDetail.mockRejectedValue(new ApiError(404, "not_found"));
    renderPage();
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("This session does not exist.");
    expect(screen.getByRole("link", { name: "Scan more payslips" })).toHaveAttribute("href", "/");
  });

  it("stops on a request error and resumes when asked", async () => {
    mockedDetail.mockRejectedValueOnce(new ApiError(500)).mockResolvedValue(session(summary("a")));
    renderPage();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("The session could not be loaded.");

    await tick();
    expect(mockedDetail).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(mockedDetail).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("counts payslips in review and confirmed as ready", async () => {
    mockedDetail.mockResolvedValue(
      session(
        summary("a", { status: "review", tablesStatus: "ready" }),
        summary("b", { status: "confirmed", tablesStatus: "ready" }),
        summary("c"),
        summary("d", { status: "failed", failureReason: "provider_rejected" }),
      ),
    );
    renderPage();
    await flush();

    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 ready to review");
  });
});

describe("SessionPage document preview (Task 08 D1)", () => {
  const readable = () =>
    session(
      summary("ready", { status: "review", tablesStatus: "ready" }),
      summary("busy"),
      summary("broken", { status: "failed", failureReason: "unreadable_document" }),
      summary("done", { status: "confirmed", tablesStatus: "ready" }),
    );
  const show = { name: "Show document" };

  it("offers Show document only on payslips with a readable form", async () => {
    mockedDetail.mockResolvedValue(readable());
    renderPage();
    await flush();

    const [ready, busy, broken, done] = rows();
    expect(within(ready!).getByRole("button", show)).toHaveAttribute("aria-expanded", "false");
    expect(within(ready!).getByRole("button", show)).toHaveAttribute(
      "aria-controls",
      "payslip-preview",
    );
    expect(within(busy!).queryByRole("button", show)).not.toBeInTheDocument();
    expect(within(broken!).queryByRole("button", show)).not.toBeInTheDocument();
    expect(within(done!).getByRole("button", show)).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("opens the preview through ?payslip=, focuses its heading, and closes it again", async () => {
    mockedDetail.mockResolvedValue(readable());
    renderPage();
    await flush();

    fireEvent.click(within(rows()[0]!).getByRole("button", show));
    await flush();

    expect(screen.getByTestId("location")).toHaveTextContent("?payslip=ready");
    expect(screen.getByTestId("preview")).toHaveTextContent("ready ready");
    const heading = screen.getByRole("heading", { name: "Payslip 1 · ready.jpg" });
    expect(document.activeElement).toBe(heading);
    const hide = within(rows()[0]!).getByRole("button", { name: "Hide document" });
    expect(hide).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(hide);
    await flush();

    expect(screen.getByTestId("location")).toBeEmptyDOMElement();
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(within(rows()[0]!).getByRole("button", show)).toHaveAttribute("aria-expanded", "false");
  });

  it("switches the preview to another payslip", async () => {
    mockedDetail.mockResolvedValue(readable());
    renderPage("?payslip=ready");
    await flush();

    fireEvent.click(within(rows()[3]!).getByRole("button", show));
    await flush();

    expect(screen.getByTestId("location")).toHaveTextContent("?payslip=done");
    expect(screen.getByTestId("preview")).toHaveTextContent("done ready");
    expect(within(rows()[0]!).getByRole("button", show)).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a readable payslip named in the URL, without taking focus", async () => {
    mockedDetail.mockResolvedValue(readable());
    renderPage("?payslip=done");
    await flush();

    expect(screen.getByTestId("preview")).toHaveTextContent("done ready");
    expect(screen.getByRole("heading", { name: "Payslip 4 · done.jpg" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it.each(["busy", "broken", "unknown"])(
    "ignores ?payslip=%s: no preview and no error",
    async (id) => {
      mockedDetail.mockResolvedValue(readable());
      renderPage(`?payslip=${id}`);
      await flush();

      expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("passes the polled tables status through to the open preview", async () => {
    mockedDetail.mockResolvedValue(
      session(summary("ready", { status: "review", tablesStatus: "pending" })),
    );
    renderPage("?payslip=ready");
    await flush();
    expect(screen.getByTestId("preview")).toHaveTextContent("ready pending");

    mockedDetail.mockResolvedValue(
      session(summary("ready", { status: "review", tablesStatus: "ready" })),
    );
    await tick();

    expect(screen.getByTestId("preview")).toHaveTextContent("ready ready");
  });
});
