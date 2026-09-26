import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { getPayslipSource } from "../api/client";
import { loadPdfDocument, type LoadedPdf } from "../review/pdfDocument";
import { SourceThumbnail } from "./SourceThumbnail";

vi.mock("../api/client", () => ({ getPayslipSource: vi.fn() }));
vi.mock("../review/pdfDocument", async (original) => ({
  ...(await original<typeof import("../review/pdfDocument")>()),
  loadPdfDocument: vi.fn(),
}));

const NO_PREVIEW = "No preview in this browser";

function source(contentType: string) {
  return {
    url: "https://example.test/signed",
    contentType,
    originalFilename: "page.jpg",
    expiresAt: "2026-09-26T10:05:00.000Z",
  } as Awaited<ReturnType<typeof getPayslipSource>>;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getPayslipSource).mockReset();
  vi.mocked(loadPdfDocument).mockReset();
});

describe("SourceThumbnail (plan 11 D12)", () => {
  it("shows an image source, and a card when the browser cannot decode it", async () => {
    vi.mocked(getPayslipSource).mockResolvedValue(source("image/heic"));
    const { container } = render(<SourceThumbnail payslipId="a" />);

    const image = await vi.waitFor(() => {
      const found = container.querySelector("img");
      if (!found) throw new Error("no image yet");
      return found;
    });
    expect(image).toHaveAttribute("src", "https://example.test/signed");
    expect(image).toHaveAttribute("alt", "");

    fireEvent.error(image);
    expect(screen.getByText(NO_PREVIEW)).toBeInTheDocument();
  });

  it("loads a PDF source and destroys it on unmount", async () => {
    const destroy = vi.fn();
    const document: LoadedPdf = {
      numPages: 2,
      viewportOf: vi.fn(() => new Promise<never>(() => {})),
      render: vi.fn(),
      destroy,
    };
    vi.mocked(getPayslipSource).mockResolvedValue(source("application/pdf"));
    vi.mocked(loadPdfDocument).mockResolvedValue(document);
    const { container, unmount } = render(<SourceThumbnail payslipId="a" />);

    await vi.waitFor(() => {
      if (!container.querySelector("canvas")) throw new Error("no canvas yet");
    });
    expect(loadPdfDocument).toHaveBeenCalledWith(
      "https://example.test/signed",
      expect.any(AbortSignal),
    );

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("shows the card and logs when the source cannot be fetched", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPayslipSource).mockRejectedValue(new Error("offline"));

    render(<SourceThumbnail payslipId="a" />);

    expect(await screen.findByText(NO_PREVIEW)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "[merge] could not load a source thumbnail",
      expect.any(Error),
    );
  });
});
