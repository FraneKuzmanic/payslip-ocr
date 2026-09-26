import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { PayslipListItem } from "@payslip/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deletePayslip, exportPayslip, exportPayslips, getPayslips } from "../api/client";
import { exportFilename, payslipExportFilename, saveBlob } from "../history/download";
import i18n from "../i18n";
import { HistoryPage } from "./HistoryPage";

vi.mock("../api/client", () => ({
  getPayslips: vi.fn(),
  deletePayslip: vi.fn(),
  exportPayslips: vi.fn(),
  exportPayslip: vi.fn(),
}));
vi.mock("../history/download", () => ({
  exportFilename: vi.fn((format: string) => `payslips-2026-09-26.${format}`),
  payslipExportFilename: vi.fn(
    (_payslip: unknown, format: string) => `payslip-2025-06-00000000.${format}`,
  ),
  saveBlob: vi.fn(),
}));
const keep = vi.fn();
vi.mock("../review/unsaved/useUnsavedEdits", () => ({
  useUnsavedEdits: () => ({ keep }),
}));

const PAYSLIP_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000009";

const payslip: PayslipListItem = {
  id: PAYSLIP_ID,
  sessionId: SESSION_ID,
  userId: "00000000-0000-4000-8000-000000000002",
  status: "confirmed",
  tablesStatus: "ready",
  pageCount: 1,
  currency: "EUR",
  warnings: [],
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
  employeeName: "Ana Horvat",
  employerName: "Primjer d.o.o.",
  period: "2025-06",
  iznosZaIsplatu: "1772.15",
  originalFilename: "A01.pdf",
};

const mockedGetPayslips = vi.mocked(getPayslips);
const mockedDeletePayslip = vi.mocked(deletePayslip);
const mockedExportPayslips = vi.mocked(exportPayslips);
const mockedExportPayslip = vi.mocked(exportPayslip);
const mockedExportFilename = vi.mocked(exportFilename);
const mockedPayslipExportFilename = vi.mocked(payslipExportFilename);
const mockedSaveBlob = vi.mocked(saveBlob);

function page(items = [payslip], total = items.length, pageNumber = 1, limit = 20) {
  return { items, page: pageNumber, limit, total };
}

/** jsdom has no matchMedia, so the page falls back to cards; a width test says which it means. */
function stubViewport(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

function SessionDestination() {
  const location = useLocation();
  return <p>{`Session ${location.pathname}${location.search}`}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/history"]}>
      <Routes>
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDestination />} />
        <Route path="/" element={<p>Capture destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every per-payslip action lives behind that payslip's overflow menu, at both widths. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name = "Ana Horvat") {
  await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  mockedGetPayslips.mockResolvedValue(page());
  mockedDeletePayslip.mockResolvedValue();
  mockedExportPayslips.mockResolvedValue(new Blob(["export"]));
  mockedExportPayslip.mockResolvedValue(new Blob(["export"]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HistoryPage", () => {
  it("renders a row's name, employer, period, amount, status and upload date", async () => {
    renderPage();

    expect(await screen.findByText("Ana Horvat")).toBeInTheDocument();
    expect(screen.getByText("Primjer d.o.o.")).toBeInTheDocument();
    expect(screen.getByText("2025-06")).toBeInTheDocument();
    expect(screen.getByText("€1,772.15")).toBeInTheDocument();
    expect(screen.getByText("Confirmed", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Uploaded Sep 25, 2026")).toBeInTheDocument();
  });

  it("renders the period and amount in Croatian form, with the Croatian count", async () => {
    await i18n.changeLanguage("hr");
    renderPage();

    expect(await screen.findByText("06/2025")).toBeInTheDocument();
    // The matcher normalises the currency's no-break space; `historyRow.test.ts` checks it exactly.
    expect(screen.getByText("1.772,15 €")).toBeInTheDocument();
    expect(screen.getByText("1 platna lista")).toBeInTheDocument();
  });

  it("renders a table at desktop width and a card list below it, never both", async () => {
    stubViewport(true);
    renderPage();

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Period",
      "Employee",
      "Employer",
      "Amount paid out",
      "Status",
      "Uploaded",
      "Actions",
    ]);
    const row = within(table).getAllByRole("row")[1];
    expect(within(row!).getByRole("link", { name: "Ana Horvat" })).toHaveAttribute(
      "href",
      `/sessions/${SESSION_ID}?payslip=${PAYSLIP_ID}`,
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders cards below desktop width", async () => {
    stubViewport(false);
    renderPage();

    expect(await screen.findByRole("list")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("opens the row's session on that payslip from the table row and from the link", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    const { unmount } = renderPage();

    await user.click(await screen.findByText("Primjer d.o.o."));
    expect(
      await screen.findByText(`Session /sessions/${SESSION_ID}?payslip=${PAYSLIP_ID}`),
    ).toBeInTheDocument();
    unmount();

    stubViewport(false);
    renderPage();
    await user.click(await screen.findByRole("link", { name: /Ana Horvat/ }));
    expect(
      await screen.findByText(`Session /sessions/${SESSION_ID}?payslip=${PAYSLIP_ID}`),
    ).toBeInTheDocument();
  });

  it("names a row by its file before extraction, and falls back to the untitled copy", async () => {
    mockedGetPayslips.mockResolvedValue(
      page([
        {
          ...payslip,
          status: "failed",
          employeeName: null,
          employerName: null,
          period: null,
          iznosZaIsplatu: null,
        },
        {
          ...payslip,
          id: "00000000-0000-4000-8000-000000000003",
          status: "processing",
          employeeName: null,
          originalFilename: undefined,
        },
      ]),
    );
    renderPage();

    expect(await screen.findByText("A01.pdf")).toBeInTheDocument();
    expect(screen.getByText("Untitled payslip")).toBeInTheDocument();
    expect(screen.getByText("Period not read")).toBeInTheDocument();
    expect(screen.getByText("Amount not read")).toBeInTheDocument();
  });

  it("renders an empty state with a capture link", async () => {
    mockedGetPayslips.mockResolvedValue(page([], 0));
    renderPage();

    expect(
      await screen.findByText("Payslips you scan or upload will appear here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scan a payslip" })).toHaveAttribute("href", "/");
  });

  it("says a filter matched nothing rather than that there are no payslips", async () => {
    const user = userEvent.setup();
    mockedGetPayslips.mockResolvedValueOnce(page());
    mockedGetPayslips.mockResolvedValue(page([], 0));
    renderPage();

    await user.selectOptions(await screen.findByLabelText("Status"), "failed");

    expect(await screen.findByText("No payslip has this status.")).toBeInTheDocument();
    expect(screen.queryByText("No payslips yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Scan a payslip" })).not.toBeInTheDocument();
  });

  it("retries a failed load", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedGetPayslips.mockRejectedValueOnce(new Error("offline"));
    mockedGetPayslips.mockResolvedValueOnce(page());
    renderPage();

    expect(
      await screen.findByText("Your payslips could not be loaded. Try again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mockedGetPayslips).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Ana Horvat")).toBeInTheDocument();
  });

  it("filters by status from the first page, with every status translated", async () => {
    const user = userEvent.setup();
    mockedGetPayslips.mockResolvedValue(page([payslip], 45));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedGetPayslips).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
    const filter = await screen.findByLabelText("Status");
    expect(
      within(filter)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All", "Reading the payslip", "Ready to review", "Confirmed", "Failed"]);
    await user.selectOptions(filter, "confirmed");
    await waitFor(() =>
      expect(mockedGetPayslips).toHaveBeenLastCalledWith({ page: 1, status: "confirmed" }),
    );
  });

  it("pages forward, and disables Previous on the first page", async () => {
    const user = userEvent.setup();
    mockedGetPayslips.mockResolvedValue(page([payslip], 45));
    renderPage();

    const previous = await screen.findByRole<HTMLButtonElement>("button", { name: "Previous" });
    expect(previous).toBeDisabled();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockedGetPayslips).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("steps back from a page a delete has emptied", async () => {
    const user = userEvent.setup();
    mockedGetPayslips.mockResolvedValueOnce(page([payslip], 21));
    mockedGetPayslips.mockResolvedValueOnce(page([payslip], 21, 2));
    mockedGetPayslips.mockResolvedValueOnce(page([], 20, 2));
    mockedGetPayslips.mockResolvedValue(page([payslip], 20));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await openRowMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete payslip" }),
    );

    await waitFor(() =>
      expect(mockedGetPayslips).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
    );
    expect(await screen.findByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("confirms a delete naming the payslip, clears its unsaved edits, then reloads", async () => {
    const user = userEvent.setup();
    renderPage();

    await openRowMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mockedDeletePayslip).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^Ana Horvat will disappear/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete payslip" }));

    await waitFor(() => expect(mockedDeletePayslip).toHaveBeenCalledWith(PAYSLIP_ID));
    expect(keep).toHaveBeenCalledWith(PAYSLIP_ID, null);
    await waitFor(() => expect(mockedGetPayslips).toHaveBeenCalledTimes(2));
  });

  it("keeps the payslip when the delete dialog is dismissed", async () => {
    const user = userEvent.setup();
    renderPage();

    await openRowMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep it" }));

    expect(mockedDeletePayslip).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the dialog on a failed delete, so the report is not behind it", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedDeletePayslip.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    await openRowMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete payslip" }),
    );

    expect(
      await screen.findByText("This payslip could not be deleted. Try again."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(keep).not.toHaveBeenCalled();
  });

  it.each(["csv", "json"] as const)("downloads one confirmed payslip as %s", async (format) => {
    const user = userEvent.setup();
    const blob = new Blob([format]);
    mockedExportPayslip.mockResolvedValue(blob);
    renderPage();

    await openRowMenu(user);
    await user.click(screen.getByRole("button", { name: `Download ${format.toUpperCase()}` }));

    await waitFor(() => expect(mockedExportPayslip).toHaveBeenCalledWith(PAYSLIP_ID, format));
    expect(mockedPayslipExportFilename).toHaveBeenCalledWith(payslip, format);
    expect(mockedSaveBlob).toHaveBeenCalledWith(blob, `payslip-2025-06-00000000.${format}`);
  });

  it("offers only Delete for a payslip that is not confirmed", async () => {
    const user = userEvent.setup();
    mockedGetPayslips.mockResolvedValue(page([{ ...payslip, status: "review" }]));
    renderPage();

    await openRowMenu(user);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download JSON" })).not.toBeInTheDocument();
  });

  it.each([
    ["CSV", "csv"],
    ["JSON", "json"],
  ] as const)("downloads every confirmed payslip as %s from the toolbar", async (label, format) => {
    const user = userEvent.setup();
    const blob = new Blob([format]);
    mockedExportPayslips.mockResolvedValue(blob);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: `All confirmed as ${label}` }));

    await waitFor(() => expect(mockedExportPayslips).toHaveBeenCalledWith(format));
    expect(mockedExportFilename).toHaveBeenCalledWith(format, expect.any(Date));
    expect(mockedSaveBlob).toHaveBeenCalledWith(blob, `payslips-2026-09-26.${format}`);
  });

  it("announces a running export and keeps the export trigger operable", async () => {
    let resolveExport: ((value: Blob) => void) | undefined;
    mockedExportPayslips.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "All confirmed as JSON" }));

    const trigger = screen.getByRole("button", { name: "Export" });
    expect(trigger).toBeEnabled();
    expect(screen.getByText("Preparing export")).toBeInTheDocument();

    resolveExport?.(new Blob(["json"]));
  });

  it("reports an export failure in translated copy and logs the detail", async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedExportPayslips.mockRejectedValueOnce(new Error("export failed"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "All confirmed as CSV" }));

    expect(
      await screen.findByText("The export could not be created. Try again."),
    ).toBeInTheDocument();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[history]"), expect.any(Error));
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("reports a single-payslip download failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedExportPayslip.mockRejectedValueOnce(new Error("download failed"));
    renderPage();

    await openRowMenu(user);
    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(
      await screen.findByText("The export could not be created. Try again."),
    ).toBeInTheDocument();
  });
});
