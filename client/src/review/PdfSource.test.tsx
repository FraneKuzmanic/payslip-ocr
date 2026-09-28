import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { loadPdfDocument, type LoadedPdf } from "./pdfDocument";
import { PdfSource } from "./PdfSource";

vi.mock("./pdfDocument", async (original) => ({
  ...(await original<typeof import("./pdfDocument")>()),
  loadPdfDocument: vi.fn(),
}));

/** Page 1 measures at once; page 2 never does, so the page change stays in flight. */
function twoPagePdf(): LoadedPdf {
  return {
    numPages: 2,
    viewportOf: vi.fn((page: number) =>
      page === 1 ? Promise.resolve({ width: 595, height: 842 }) : new Promise<never>(() => {}),
    ),
    render: vi.fn(() => ({ completed: new Promise<void>(() => {}), cancel: vi.fn() })),
    destroy: vi.fn(),
  };
}

function renderPdf() {
  return render(
    <PdfSource
      url="https://example.test/source.pdf"
      regions={{ pages: [{ page: 1, aspectRatio: 595 / 842 }], regions: [] }}
      activeField={null}
      interaction="popover"
      fieldValues={{}}
      lowConfidenceFields={[]}
      ungroundableFields={[]}
      unreadableFields={[]}
      editedFields={[]}
      onUnavailable={vi.fn()}
    />,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.mocked(loadPdfDocument).mockResolvedValue(twoPagePdf());
});

afterEach(() => {
  vi.mocked(loadPdfDocument).mockReset();
});

describe("PdfSource page change (Task 14 D20)", () => {
  it("keeps the viewer mounted with a spinner while the next page is measured", async () => {
    renderPdf();
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await act(async () => {});

    // The frame is still there, so the page keeps its height and does not jump to the top.
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
});
