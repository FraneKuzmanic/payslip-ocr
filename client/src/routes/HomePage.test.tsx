import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewUnavailableError, analyzeSourceImage } from "../capture/sourceFile";
import { downscaleSourceImage } from "../capture/downscale";
import i18n from "../i18n";
import type { StartBatchResult } from "../upload/UploadBatchContext";
import { HomePage } from "./HomePage";

const startBatch = vi.fn<(files: readonly File[]) => Promise<StartBatchResult>>();

vi.mock("../upload/useUploadBatch", () => ({
  useUploadBatch: () => ({ startBatch, itemsFor: () => [], dismiss: vi.fn() }),
}));

vi.mock("../capture/sourceFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capture/sourceFile")>()),
  analyzeSourceImage: vi.fn(),
}));

vi.mock("../capture/downscale", () => ({ downscaleSourceImage: vi.fn((file: File) => file) }));

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/sessions/:sessionId" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

function imageFile(name = "platna.jpg") {
  return new File(["payslip"], name, { type: "image/jpeg" });
}

/** jsdom implements no matchMedia, so the pointer type has to be supplied explicitly. */
function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: coarse, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

// `applyAccept: false`: the classification under test is the page's, not user-event's.
const user = () => userEvent.setup({ applyAccept: false });
const fileInput = () => screen.getByLabelText("Choose files");
const tray = () => screen.getByRole("list", { name: "Selected payslips" });
const uploadButton = (count: number) =>
  screen.getByRole("button", {
    name: count === 1 ? "Upload 1 payslip" : `Upload ${count} payslips`,
  });

const mockedAnalyze = vi.mocked(analyzeSourceImage);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  stubPointer(true);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
  mockedAnalyze.mockResolvedValue({ width: 1200, height: 1600, blurVariance: 100, warnings: [] });
  startBatch.mockResolvedValue({ ok: true, sessionId: SESSION_ID });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HomePage", () => {
  it("renders the translated heading", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payslip digitization");
  });

  it("offers a single-shot camera and a multiple-file picker on a touch device", () => {
    renderPage();

    const camera = screen.getByLabelText("Scan payslip");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).not.toHaveAttribute("multiple");
    expect(fileInput()).toHaveAttribute("multiple");
    expect(fileInput()).toHaveAttribute("accept", expect.stringContaining("application/pdf"));
  });

  it("offers only the file picker, as the primary action, without a coarse pointer", () => {
    stubPointer(false);
    renderPage();

    expect(screen.queryByLabelText("Scan payslip")).toBeNull();
    expect(fileInput().closest("label")).toHaveClass("bg-accent");
  });

  it("adds files to a tray and removes them one at a time", async () => {
    renderPage();

    await user().upload(fileInput(), [imageFile("a.jpg"), imageFile("b.jpg"), imageFile("c.jpg")]);

    expect(await within(tray()).findAllByRole("img")).toHaveLength(3);
    expect(uploadButton(3)).toBeInTheDocument();
    expect(screen.getByLabelText("Scan another")).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "Remove b.jpg" }));

    expect(within(tray()).getAllByRole("listitem")).toHaveLength(2);
    expect(uploadButton(2)).toBeInTheDocument();
  });

  it("formats the file size in the UI language, not the browser's", async () => {
    await i18n.changeLanguage("hr");
    renderPage();
    const file = new File(["%PDF"], "platna.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 1.5 * 1024 * 1024 });

    await user().upload(screen.getByLabelText("Odaberi datoteku"), [file]);

    const list = screen.getByRole("list", { name: "Odabrane platne liste" });
    expect(await within(list).findByText(/1,5 MB/)).toBeInTheDocument();
  });

  it("keeps the first ten, says how many were left out, and makes the pickers inert", async () => {
    renderPage();
    const files = Array.from({ length: 12 }, (_, index) => imageFile(`p${index}.jpg`));

    await user().upload(fileInput(), files);

    expect(within(tray()).getAllByRole("listitem")).toHaveLength(10);
    expect(
      screen.getByText("2 files were not added: a session holds at most 10 payslips."),
    ).toBeInTheDocument();
    for (const input of [fileInput(), screen.getByLabelText("Scan another")]) {
      expect(input).toHaveAttribute("aria-disabled", "true");
      expect(input).toHaveAccessibleDescription("At most 10 payslips have been added.");
      expect(input).not.toBeDisabled();
    }
  });

  it("refuses a file over the size limit with the upload copy and does not add it", async () => {
    renderPage();
    const large = imageFile("large.jpg");
    Object.defineProperty(large, "size", { value: 11 * 1024 * 1024 });

    await user().upload(fileInput(), [large]);

    expect(
      screen.getByText("large.jpg: This file is too large. The maximum size is 10 MB."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Selected payslips" })).toBeNull();
  });

  it("uploads the original file when this browser cannot preview it", async () => {
    mockedAnalyze.mockRejectedValueOnce(new PreviewUnavailableError());
    renderPage();
    const heic = new File(["heic"], "platna.heic", { type: "image/heic" });

    await user().upload(fileInput(), [heic]);
    expect(
      await screen.findByText(
        "Preview is not available in this browser. The file will still be uploaded.",
      ),
    ).toBeInTheDocument();
    expect(downscaleSourceImage).not.toHaveBeenCalled();

    await user().click(uploadButton(1));

    expect(startBatch).toHaveBeenCalledWith([heic]);
  });

  it("keeps the pressed button focusable and announces the upload while it starts", async () => {
    startBatch.mockReturnValue(new Promise(() => {}));
    renderPage();
    await user().upload(fileInput(), [imageFile()]);
    const button = uploadButton(1);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "false"));

    await user().click(button);

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Uploading your payslips.");
  });

  it("navigates to the session once the first payslip exists", async () => {
    renderPage();
    await user().upload(fileInput(), [imageFile("a.jpg"), imageFile("b.jpg")]);
    await within(tray()).findAllByRole("img");

    await user().click(uploadButton(2));

    expect(await screen.findByTestId("location")).toHaveTextContent(`/sessions/${SESSION_ID}`);
    expect(startBatch.mock.calls[0]?.[0].map((file) => file.name)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("stays on the tray with each file's reason when every file is refused", async () => {
    startBatch.mockResolvedValue({
      ok: false,
      errors: new Map([
        [0, "pdf_encrypted"],
        [1, "network"],
      ]),
    });
    renderPage();
    const pdf = new File(["%PDF"], "zakljucano.pdf", { type: "application/pdf" });
    await user().upload(fileInput(), [pdf, imageFile("b.jpg")]);
    await within(tray()).findAllByRole("img");

    await user().click(uploadButton(2));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "None of the files could be uploaded. Remove them or choose others.",
    );
    expect(
      screen.getByText(
        "This PDF is password-protected and cannot be read. Save an unprotected copy and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("The upload failed. Check your connection.")).toBeInTheDocument();
    expect(within(tray()).getAllByRole("listitem")).toHaveLength(2);
  });
});
