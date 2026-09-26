import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router";
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

const unsaved = new Set<string>();
vi.mock("../review/unsaved/useUnsavedEdits", () => ({
  useUnsavedEdits: () => ({ unsaved }),
}));
vi.mock("../review/PayslipReview", () => ({
  PayslipReview: ({ payslipId, tablesStatus }: { payslipId: string; tablesStatus: string }) => (
    <p data-testid="preview">{payslipId + " " + tablesStatus}</p>
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
  const navigation = useNavigationType();
  return (
    <>
      <p data-testid="location">{location.search}</p>
      <p data-testid="navigation">{navigation}</p>
    </>
  );
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
const tabs = () => screen.getAllByRole("tab");

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  batchItems = [];
  unsaved.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockedDetail.mockReset();
  mockedRetry.mockReset();
  dismiss.mockReset();
});

describe("SessionPage", () => {
  it("lists every payslip as a tab in server order with its period or filename and status", async () => {
    mockedDetail.mockResolvedValue(
      session(
        summary("first", { status: "review", period: "2025-03" }),
        summary("second", { status: "failed", failureReason: "unreadable_document" }),
      ),
    );
    renderPage();
    await flush();
    expect(tabs()[0]).toHaveTextContent("2025-03");
    expect(tabs()[0]).toHaveTextContent("Ready to review");
    expect(tabs()[1]).toHaveTextContent("second.jpg");
    expect(tabs()[1]).toHaveTextContent("Failed");
    fireEvent.click(tabs()[1]!);
    await flush();
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "The document could not be read. Try a sharper photo.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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
    expect(screen.getByTestId("preview")).toHaveTextContent("a ready");

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

    const [second, third] = rows();
    expect(rows()).toHaveLength(2);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveTextContent("a.jpg");
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
    fireEvent.click(tabs()[1]!);
    await flush();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(tabs()[0]!);
    await flush();

    mockedDetail.mockResolvedValue(
      session(summary("a"), summary("b", { status: "failed", failureReason: "provider_rejected" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();

    expect(mockedRetry).toHaveBeenCalledWith("a");
    expect(tabs()[0]).toHaveTextContent("Reading the payslip");
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

  it("keeps focus on the selected tab once a retry replaces its button", async () => {
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

    expect(document.activeElement).toBe(tabs()[0]);
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
    expect(tabs()[0]).toHaveTextContent("Reading the payslip");
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

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The retry could not be started. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(tabs()[1]!);
    await flush();
    expect(screen.queryByRole("alert")).toBeNull();
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

describe("SessionPage navigation (Task 10)", () => {
  const readable = () =>
    session(
      summary("ready", { status: "review", tablesStatus: "ready" }),
      summary("busy"),
      summary("broken", { status: "failed", failureReason: "unreadable_document" }),
      summary("done", { status: "confirmed", tablesStatus: "ready" }),
    );

  it.each(["", "?payslip=unknown"])(
    "selects the first payslip by replacement for %s",
    async (search) => {
      mockedDetail.mockResolvedValue(readable());
      renderPage(search);
      await flush();
      expect(screen.getByTestId("location")).toHaveTextContent("?payslip=ready");
      expect(screen.getByTestId("navigation")).toHaveTextContent("REPLACE");
      expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "payslip-tab-ready");
      expect(screen.getByTestId("preview")).toHaveTextContent("ready ready");
      expect(document.activeElement).toBe(document.body);
    },
  );

  it("keeps a processing payslip selected and opens its form when extraction completes", async () => {
    mockedDetail.mockResolvedValue(readable());
    renderPage("?payslip=busy");
    await flush();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("This payslip is still being read.");
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    mockedDetail.mockResolvedValue(
      session(summary("busy", { status: "review", tablesStatus: "ready" })),
    );
    await tick();
    expect(screen.getByTestId("preview")).toHaveTextContent("busy ready");
    expect(screen.getByTestId("location")).toHaveTextContent("?payslip=busy");
  });

  it("switches with a push and no discard dialog, keeping focus on the tab", async () => {
    unsaved.add("ready");
    mockedDetail.mockResolvedValue(readable());
    renderPage();
    await flush();
    const tab = tabs()[3]!;
    tab.focus();
    fireEvent.click(tab);
    await flush();
    expect(screen.getByTestId("location")).toHaveTextContent("?payslip=done");
    expect(screen.getByTestId("navigation")).toHaveTextContent("PUSH");
    expect(screen.getByTestId("preview")).toHaveTextContent("done ready");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tab).toHaveFocus();
    expect(tabs()[0]).toHaveTextContent("Unsaved changes");
  });

  it("reopens the URL selection without stealing focus", async () => {
    mockedDetail.mockResolvedValue(readable());
    renderPage("?payslip=done");
    await flush();
    expect(screen.getByTestId("preview")).toHaveTextContent("done ready");
    expect(screen.getByRole("heading", { name: "Payslip 4 · done.jpg" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it.each([false, true])("sets vertical orientation only at xl: %s", async (xl) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 1280px)" && xl,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    mockedDetail.mockResolvedValue(readable());
    renderPage();
    await flush();
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      xl ? "vertical" : "horizontal",
    );
  });

  it("passes the polled tables status through to the open form", async () => {
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
