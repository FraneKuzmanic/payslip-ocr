import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipSummary } from "@payslip/shared";
import { mergePayslips } from "../api/client";
import i18n from "../i18n";
import { MergeDialog } from "./MergeDialog";

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
  return { ApiError, mergePayslips: vi.fn() };
});
vi.mock("./SourceThumbnail", () => ({
  SourceThumbnail: ({ payslipId }: { payslipId: string }) => (
    <span>{`thumbnail ${payslipId}`}</span>
  ),
}));

const { ApiError } = await import("../api/client");
const mockedMerge = vi.mocked(mergePayslips);

function summary(id: string, overrides: Partial<PayslipSummary> = {}): PayslipSummary {
  return {
    id,
    status: "review",
    tablesStatus: "ready",
    period: null,
    employeeName: null,
    pageCount: 1,
    failureReason: null,
    warningCount: 0,
    originalFilename: `${id}.jpg`,
    ...overrides,
  };
}

const payslips = [
  summary("a"),
  summary("busy", { status: "processing", tablesStatus: "pending" }),
  summary("b", { status: "failed", failureReason: "unreadable_document", pageCount: 2 }),
  summary("c", { status: "confirmed", period: "2025-03" }),
];

function renderDialog(group: readonly string[] | null, selectedId = "a") {
  const onMerged = vi.fn();
  const onRefused = vi.fn();
  const onClose = vi.fn();
  render(
    <MergeDialog
      open
      sessionId="session"
      payslips={payslips}
      group={group}
      selectedId={selectedId}
      onMerged={onMerged}
      onRefused={onRefused}
      onClose={onClose}
    />,
  );
  return { onMerged, onRefused, onClose };
}

/** The cards' filenames, top to bottom. */
const cardOrder = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => within(item).getByText(/\.jpg$/).textContent);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  // jsdom has no modal dialog; only the wiring is testable here (see ConfirmDialog).
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mockedMerge.mockReset();
});

describe("MergeDialog (plan 11 D11, Task 15b D6)", () => {
  it("picks one or more of the other mergeable payslips, then confirms in upload order", () => {
    renderDialog(null);

    expect(screen.getByRole("heading", { name: "Merge with other payslips" })).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => (box as HTMLInputElement).value)).toEqual(["b", "c"]);
    expect(screen.getByText("2025-03")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(next);
    expect(screen.queryByRole("list")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /c\.jpg/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /b\.jpg/ }));
    expect(next).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(next);

    expect(screen.getByRole("heading", { name: "Merge payslips" })).toBeInTheDocument();
    expect(cardOrder()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    // Page positions are cumulative: b's two pages come second.
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((item) => item.querySelector("p")?.textContent),
    ).toEqual(["Page 1", "Pages 2–3", "Page 4"]);
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("unchecking the only choice disables Continue again", () => {
    renderDialog(null);
    const box = screen.getByRole("checkbox", { name: /b\.jpg/ });

    fireEvent.click(box);
    fireEvent.click(box);

    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("opens a suggested group straight at the confirm step, in upload order", () => {
    renderDialog(["c", "a", "b"], "a");

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(cardOrder()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("moves a document down, announces it and keeps focus on the pressed button", () => {
    renderDialog(["a", "b", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Move a.jpg down" }));

    expect(cardOrder()).toEqual(["b.jpg", "a.jpg", "c.jpg"]);
    expect(screen.getByText("a.jpg is now at position 2.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move a.jpg down" })).toHaveFocus();
  });

  it("keeps focus on a move button that has just reached an end", () => {
    renderDialog(["a", "b", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Move b.jpg up" }));

    const up = screen.getByRole("button", { name: "Move b.jpg up" });
    expect(cardOrder()).toEqual(["b.jpg", "a.jpg", "c.jpg"]);
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).toHaveFocus();
  });

  it("does nothing when the first moves up or the last moves down", () => {
    renderDialog(["a", "b", "c"]);
    const up = screen.getByRole("button", { name: "Move a.jpg up" });
    const down = screen.getByRole("button", { name: "Move c.jpg down" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(down).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(up);
    fireEvent.click(down);

    expect(cardOrder()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("sends the ids in upload order and the page order as shown", async () => {
    mockedMerge.mockResolvedValue({ id: "merged", status: "processing" });
    const { onMerged } = renderDialog(["b", "a", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Move c.jpg up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move c.jpg up" }));
    expect(cardOrder()).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    });

    expect(mockedMerge).toHaveBeenCalledWith("session", {
      payslipIds: ["a", "b", "c"],
      order: ["c", "a", "b"],
    });
    expect(onMerged).toHaveBeenCalledWith("merged", ["c", "a", "b"]);
  });

  it("names the move buttons in Croatian", async () => {
    renderDialog(["a", "b"]);

    await act(() => i18n.changeLanguage("hr"));

    expect(screen.getByRole("button", { name: "Pomaknite a.jpg dolje" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pomaknite b.jpg gore" }));
    expect(screen.getByText("b.jpg je sada na mjestu 1.")).toBeInTheDocument();
  });

  it.each([
    [
      new ApiError(409, "merge_not_allowed"),
      "These payslips can no longer be merged. One of them may already be merged, deleted or being read again.",
    ],
    [
      new ApiError(422, "pdf_too_many_pages"),
      "Together these documents have more than 10 pages. A payslip can have at most 10.",
    ],
    [
      new TypeError("Failed to fetch"),
      "The merge could not be started. Check your connection and try again.",
    ],
    [
      new ApiError(500, "internal"),
      "The merge could not be started. Check your connection and try again.",
    ],
  ])("stays open and explains a failure: %s", async (error, message) => {
    mockedMerge.mockRejectedValue(error);
    const { onMerged, onRefused, onClose } = renderDialog(["a", "b"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Plan 11 D11: only a 409 means the list is stale and should be read again.
    expect(onRefused).toHaveBeenCalledTimes(
      error instanceof ApiError && error.status === 409 ? 1 : 0,
    );
  });

  it("ignores Cancel, Escape, a move and a second Merge while the request runs", () => {
    mockedMerge.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderDialog(["a", "b"]);
    const merge = screen.getByRole("button", { name: "Merge" });

    fireEvent.click(merge);
    fireEvent.click(merge);
    fireEvent.click(screen.getByRole("button", { name: "Move a.jpg down" }));
    expect(cardOrder()).toEqual(["a.jpg", "b.jpg"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(merge).toHaveAttribute("aria-disabled", "true");
    expect(mockedMerge).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Cancel and on Escape", () => {
    const { onClose } = renderDialog(["a", "b"]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
