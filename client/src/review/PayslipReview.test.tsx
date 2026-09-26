import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipDetailResponse, SourceRegionsResponse } from "@payslip/shared";
import "../i18n";
import { getPayslipDetail, getPayslipRegions } from "../api/client";
import { PayslipPreview, fieldValuesOf } from "./PayslipPreview";

vi.mock("../api/client", () => ({ getPayslipDetail: vi.fn(), getPayslipRegions: vi.fn() }));

const mounts = vi.fn();

// A stub that prints its props, and counts mounts so a refetch can be shown not to remount it.
vi.mock("./SourceDocumentPanel", () => ({
  SourceDocumentPanel: (props: Record<string, unknown>) => {
    useEffect(() => mounts(), []);
    return <pre data-testid="panel">{JSON.stringify(props)}</pre>;
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPayslipDetail).mockResolvedValue(detail());
  vi.mocked(getPayslipRegions).mockResolvedValue(regions);
});

describe("PayslipPreview", () => {
  it("passes the flattened values and every attention signal to the panel", async () => {
    render(<PayslipPreview payslipId="payslip-1" tablesStatus="pending" />);

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
    expect(panelProps()).not.toHaveProperty("onSelect");
  });

  it("reloads when the tables pass lands, without remounting the panel", async () => {
    const { rerender } = render(<PayslipPreview payslipId="payslip-1" tablesStatus="pending" />);
    await screen.findByTestId("panel");

    vi.mocked(getPayslipDetail).mockResolvedValue(
      detail({
        tablesStatus: "ready",
        payComponents: [{ naziv: "REDOVAN RAD", sati: null, koeficijent: null, iznos: "1200.00" }],
      }),
    );
    rerender(<PayslipPreview payslipId="payslip-1" tablesStatus="ready" />);

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
    render(<PayslipPreview payslipId="payslip-1" tablesStatus="ready" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The payslip could not be loaded. Try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("panel")).toBeInTheDocument();
    expect(getPayslipRegions).toHaveBeenCalledTimes(2);
  });

  it("keeps the preview when a refetch fails, says so, and retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    const { rerender } = render(<PayslipPreview payslipId="payslip-1" tablesStatus="pending" />);
    await screen.findByTestId("panel");

    vi.mocked(getPayslipRegions).mockRejectedValueOnce(new Error("offline"));
    rerender(<PayslipPreview payslipId="payslip-1" tablesStatus="ready" />);

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
