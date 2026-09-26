import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRegionsResponse } from "@payslip/shared";
import "../i18n";
import { getPayslipSource } from "../api/client";
import { SourceDocumentPanel } from "./SourceDocumentPanel";

vi.mock("../api/client", () => ({ getPayslipSource: vi.fn() }));

const WITHHELD = "Highlights are hidden because the page's orientation could not be confirmed.";
const UNAVAILABLE =
  "This browser cannot show this image. Open it in a new tab or view it on another device.";

const regions: SourceRegionsResponse = {
  pages: [{ page: 1, aspectRatio: 0.5 }],
  regions: [
    {
      fields: ["netoPlaca"],
      page: 1,
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.3, y: 0.2 },
        { x: 0.1, y: 0.2 },
      ],
      origin: "model",
    },
  ],
};

function panel(strip = false) {
  return (
    <SourceDocumentPanel
      strip={strip}
      payslipId="payslip-1"
      regions={regions}
      activeField="netoPlaca"
      interaction="popover"
      fieldValues={{ netoPlaca: "2298.97" }}
      lowConfidenceFields={[]}
      ungroundableFields={[]}
      unreadableFields={[]}
      editedFields={[]}
    />
  );
}
function renderPanel(strip = false) {
  return render(panel(strip));
}

/** jsdom never decodes an image, so its natural size is defined by hand before `load`. */
function loadImage(image: HTMLElement, width: number, height: number) {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPayslipSource).mockResolvedValue({
    url: "https://example.test/signed",
    contentType: "image/jpeg",
    originalFilename: "B02.jpg",
    expiresAt: "2026-09-25T10:05:00.000Z",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SourceDocumentPanel image path", () => {
  it("measures a never-opened image before drawing its strip, then returns to the preview without fetching again", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(343);
    const { container, rerender } = renderPanel(true);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("polygon")).toBeNull();
    loadImage(container.querySelector("img")!, 800, 1600);
    expect(container.querySelectorAll("polygon")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in a new tab" })).toBeNull();
    rerender(panel(false));
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in a new tab" })).toBeInTheDocument();
    expect(getPayslipSource).toHaveBeenCalledOnce();
  });

  it("withholds the image strip when its measured ratio disagrees", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(343);
    const { container } = renderPanel(true);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    loadImage(container.querySelector("img")!, 1600, 800);
    expect(container.querySelector("polygon")).toBeNull();
    expect(screen.getByText("This value has no highlight on the payslip.")).toBeInTheDocument();
  });
  it("shows no note and no outline before the image has loaded (D10)", async () => {
    const { container } = renderPanel();
    await screen.findByRole("img");

    expect(screen.queryByText(WITHHELD)).not.toBeInTheDocument();
    expect(container.querySelector("polygon")).toBeNull();
  });

  it("draws outlines when the rendered ratio agrees with the declared one", async () => {
    const { container } = renderPanel();
    loadImage(await screen.findByRole("img"), 800, 1600);

    expect(container.querySelector("polygon")).not.toBeNull();
    expect(screen.queryByText(WITHHELD)).not.toBeInTheDocument();
  });

  it("withholds outlines, and says why, when the ratios disagree", async () => {
    const { container } = renderPanel();
    loadImage(await screen.findByRole("img"), 1600, 800);

    expect(container.querySelector("polygon")).toBeNull();
    expect(screen.getByText(WITHHELD)).toBeInTheDocument();
  });

  it("fetches one fresh URL for a failed image, then says the browser cannot show it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPanel();

    fireEvent.error(await screen.findByRole("img"));
    fireEvent.error(await screen.findByRole("img"));

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument();
    expect(getPayslipSource).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in a new tab" })).toHaveAttribute(
      "href",
      "https://example.test/signed",
    );
  });
});
