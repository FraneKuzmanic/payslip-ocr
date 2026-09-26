import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { Link, MemoryRouter, Outlet, Route, Routes, useNavigate, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipDetailResponse, SourceRegionsResponse } from "@payslip/shared";
import { getPayslipDetail, getPayslipRegions, updatePayslip } from "../api/client";
import { ToastProvider } from "../components/Toast";
import i18n from "../i18n";
import { PayslipReview, fieldValuesOf, liveRegions } from "./PayslipReview";
import { UnsavedEditsProvider } from "./unsaved/UnsavedEditsProvider";
import { useUnsavedEdits } from "./unsaved/useUnsavedEdits";

vi.mock("../api/client", async (importActual) => ({
  ...(await importActual<typeof import("../api/client")>()),
  getPayslipDetail: vi.fn(),
  getPayslipRegions: vi.fn(),
  updatePayslip: vi.fn(),
}));

const mounts = vi.fn();

// A stub that prints its props, counts mounts so a refetch can be shown not to remount it, and
// exposes `onSelect` as a button, standing in for a click on an outline.
vi.mock("./SourceDocumentPanel", () => ({
  SourceDocumentPanel: (props: Record<string, unknown>) => {
    useEffect(() => mounts(), []);
    const onSelect = props["onSelect"] as ((path: string) => void) | undefined;
    return (
      <>
        <pre data-testid="panel">{JSON.stringify(props)}</pre>
        <button type="button" onClick={() => onSelect?.("netoPlaca")}>
          outline
        </button>
      </>
    );
  },
}));

function detail(overrides: Partial<PayslipDetailResponse> = {}): PayslipDetailResponse {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sessionId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
    status: "review",
    tablesStatus: "pending",
    pageCount: 1,
    currency: "EUR",
    warnings: [],
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
    netoPlaca: "2298.97",
    brutoPlaca: null,
    lowConfidenceFields: ["period"],
    unreadableFields: ["brutoPlaca"],
    ungroundableFields: ["iznosZaIsplatu"],
    editedFields: [],
    ...overrides,
  };
}

const regions: SourceRegionsResponse = { pages: [{ page: 1, aspectRatio: 0.7 }], regions: [] };

function panelProps() {
  return JSON.parse(screen.getByTestId("panel").textContent ?? "{}") as Record<string, unknown>;
}

function stubWide(wide: boolean, coarse = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)" ? coarse : wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function review(tablesStatus: "pending" | "ready" = "pending") {
  return (
    <ToastProvider>
      <MemoryRouter>
        <Routes>
          <Route element={<UnsavedEditsProvider />}>
            <Route
              index
              element={
                <PayslipReview
                  payslipId="payslip-1"
                  tablesStatus={tablesStatus}
                  onChanged={onChanged}
                />
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

const onChanged = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  stubWide(false);
  vi.mocked(getPayslipDetail).mockResolvedValue(detail());
  vi.mocked(getPayslipRegions).mockResolvedValue(regions);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function OpenReview() {
  const { id = "a" } = useParams();
  return <PayslipReview key={id} payslipId={id} tablesStatus="ready" onChanged={vi.fn()} />;
}

function Controls() {
  const navigate = useNavigate();
  const { unsaved } = useUnsavedEdits();
  return (
    <>
      <Link to="/review/a">open a</Link>
      <Link to="/review/b">open b</Link>
      <Link to="/">leave</Link>
      <button onClick={() => navigate(-1)}>back</button>
      <button onClick={() => navigate(1)}>forward</button>
      <p data-testid="unsaved">{[...unsaved].join(",")}</p>
    </>
  );
}

function Journey() {
  return (
    <>
      <Controls />
      <Outlet />
    </>
  );
}

const input = () => document.getElementById("review-field-netoPlaca")!;

describe("PayslipReview", () => {
  it("places the form before the source in DOM order", async () => {
    const { container } = render(review());
    await screen.findByTestId("panel");
    const form = container.querySelector("form")!;
    expect(form.compareDocumentPosition(container.querySelector("aside")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it.each([
    [false, true, true],
    [false, false, false],
    [true, true, false],
  ])("uses the strip for wide=%s coarse=%s: %s", async (wide, coarse, strip) => {
    stubWide(wide, coarse);
    render(review());
    await screen.findByTestId("panel");
    await userEvent.click(document.getElementById("review-field-netoPlaca")!);
    expect(panelProps()["strip"]).toBe(strip);
    expect(document.documentElement.hasAttribute("data-keyboard")).toBe(strip);
    await userEvent.click(document.body);
    expect(panelProps()["strip"]).toBe(false);
  });

  it("keeps edits across selections, Back/Forward and route departure in StrictMode", async () => {
    vi.mocked(getPayslipDetail).mockImplementation(async (id) =>
      detail({ id, tablesStatus: "ready" }),
    );
    vi.mocked(updatePayslip).mockImplementation(async (id, patch) =>
      detail({ id, tablesStatus: "ready", ...patch }),
    );
    render(
      <StrictMode>
        <ToastProvider>
          <MemoryRouter initialEntries={["/review/a"]}>
            <Routes>
              <Route element={<UnsavedEditsProvider />}>
                <Route element={<Journey />}>
                  <Route path="/review/:id" element={<OpenReview />} />
                  <Route index element={<p>away</p>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </StrictMode>,
    );
    await screen.findByTestId("panel");
    await userEvent.clear(input());
    await userEvent.type(input(), "42.00");
    await userEvent.click(screen.getByText("open b"));
    await waitFor(() => expect(panelProps()["payslipId"]).toBe("b"));
    expect(screen.getByTestId("unsaved")).toHaveTextContent("a");
    await userEvent.click(screen.getByText("back"));
    await waitFor(() => expect(input()).toHaveValue("42.00"));
    await userEvent.click(screen.getByText("forward"));
    await waitFor(() => expect(panelProps()["payslipId"]).toBe("b"));
    await userEvent.click(screen.getByText("open a"));
    await waitFor(() => expect(input()).toHaveValue("42.00"));
    await userEvent.click(screen.getByText("leave"));
    expect(screen.getByText("away")).toBeInTheDocument();
    await userEvent.click(screen.getByText("open a"));
    await waitFor(() => expect(input()).toHaveValue("42.00"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updatePayslip).toHaveBeenCalledWith("a", { netoPlaca: "42.00" }));
    await waitFor(() => expect(screen.getByTestId("unsaved")).toBeEmptyDOMElement());
  });
  it("passes the flattened values and every attention signal to the panel", async () => {
    render(review());

    await screen.findByTestId("panel");
    expect(panelProps()).toMatchObject({
      payslipId: "payslip-1",
      regions,
      activeField: null,
      interaction: "popover",
      fieldValues: { netoPlaca: "2298.97" },
      lowConfidenceFields: ["period"],
      unreadableFields: ["brutoPlaca"],
      ungroundableFields: ["iznosZaIsplatu"],
      editedFields: [],
      showTitle: false,
    });
  });

  it("focuses outlines' inputs directly at lg", async () => {
    stubWide(true);
    render(review());

    await screen.findByTestId("panel");
    expect(panelProps()).toMatchObject({ interaction: "focus" });
  });

  it("focuses a selected region's input", async () => {
    render(review());
    await screen.findByTestId("panel");

    await userEvent.click(screen.getByRole("button", { name: "outline" }));

    expect(document.getElementById("review-field-netoPlaca")).toHaveFocus();
    expect(panelProps()).toMatchObject({ activeField: "netoPlaca" });
  });

  it("makes a focused field's region the active one", async () => {
    render(review());
    await screen.findByTestId("panel");

    await userEvent.click(document.getElementById("review-field-brutoPlaca")!);

    expect(panelProps()).toMatchObject({ activeField: "brutoPlaca" });
  });

  it("hides the source on a phone without unmounting it", async () => {
    render(review());
    await screen.findByTestId("panel");
    const toggle = screen.getByRole("button", { name: "Hide document" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "payslip-source");

    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Show document" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.getElementById("payslip-source")).toHaveClass("hidden");
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledOnce();
  });

  it("gives the panel the saved edits after a save", async () => {
    vi.mocked(getPayslipDetail).mockResolvedValue(detail({ tablesStatus: "ready" }));
    vi.mocked(updatePayslip).mockResolvedValue(
      detail({ tablesStatus: "ready", netoPlaca: "1.00", editedFields: ["netoPlaca"] }),
    );
    render(review("ready"));
    await screen.findByTestId("panel");

    const neto = document.getElementById("review-field-netoPlaca")!;
    await userEvent.clear(neto);
    await userEvent.type(neto, "1.00");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(panelProps()).toMatchObject({ editedFields: ["netoPlaca"] }));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("reloads when the tables pass lands, without remounting the panel", async () => {
    const { rerender } = render(review("pending"));
    await screen.findByTestId("panel");

    vi.mocked(getPayslipDetail).mockResolvedValue(
      detail({
        tablesStatus: "ready",
        payComponents: [{ naziv: "REDOVAN RAD", sati: null, koeficijent: null, iznos: "1200.00" }],
      }),
    );
    rerender(review("ready"));

    await waitFor(() =>
      expect(panelProps()["fieldValues"]).toHaveProperty(["payComponents.0.iznos"], "1200.00"),
    );
    expect(getPayslipDetail).toHaveBeenCalledTimes(2);
    expect(getPayslipRegions).toHaveBeenCalledTimes(2);
    expect(mounts).toHaveBeenCalledOnce();
  });

  it("says the payslip could not be loaded, and retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPayslipRegions).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(review("ready"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The payslip could not be loaded. Try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("panel")).toBeInTheDocument();
    expect(getPayslipRegions).toHaveBeenCalledTimes(2);
  });

  it("keeps the review when a refetch fails, says so, and retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    const { rerender } = render(review("pending"));
    await screen.findByTestId("panel");

    vi.mocked(getPayslipRegions).mockRejectedValueOnce(new Error("offline"));
    rerender(review("ready"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The highlights could not be updated, so some may be missing. Try again.",
    );
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(getPayslipRegions).toHaveBeenCalledTimes(3);
    expect(mounts).toHaveBeenCalledOnce();
  });
});

describe("fieldValuesOf", () => {
  it("flattens scalars and table cells by canonical path, leaving nulls out", () => {
    expect(
      fieldValuesOf(
        detail({
          period: "2025-06",
          obustave: [
            {
              naziv: "KREDIT",
              vjerovnik: null,
              iznos: "50.00",
              ostatakSalda: null,
              brojRata: "10/120",
            },
          ],
        }),
      ),
    ).toEqual({
      netoPlaca: "2298.97",
      period: "2025-06",
      "obustave.0.naziv": "KREDIT",
      "obustave.0.iznos": "50.00",
      "obustave.0.brojRata": "10/120",
    });
  });
});

function region(...fields: string[]) {
  return {
    fields,
    page: 1,
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    origin: "model" as const,
  };
}

describe("liveRegions", () => {
  it("drops the outlines of table rows the saved payslip no longer has", () => {
    const row = {
      naziv: "KREDIT",
      vjerovnik: null,
      iznos: "50.00",
      ostatakSalda: null,
      brojRata: null,
    };
    const withRemovedRow: SourceRegionsResponse = {
      pages: [{ page: 1, aspectRatio: 0.7 }],
      regions: [region("netoPlaca"), region("obustave.0.iznos"), region("obustave.1.iznos")],
    };

    expect(liveRegions(withRemovedRow, detail({ obustave: [row] })).regions).toEqual([
      region("netoPlaca"),
      region("obustave.0.iznos"),
    ]);
  });
});
