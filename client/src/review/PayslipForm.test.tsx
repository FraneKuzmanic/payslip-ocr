import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipDetailResponse } from "@payslip/shared";
import { ApiError, confirmPayslip, updatePayslip } from "../api/client";
import { ToastProvider } from "../components/Toast";
import i18n from "../i18n";
import { PayslipForm } from "./PayslipForm";
import { toFormValues } from "./reviewForm";
import type { UnsavedEdits } from "./unsaved/UnsavedEditsContext";
import { StrictMode } from "react";

vi.mock("../api/client", async (importActual) => ({
  ...(await importActual<typeof import("../api/client")>()),
  updatePayslip: vi.fn(),
  confirmPayslip: vi.fn(),
}));

const mockedUpdate = vi.mocked(updatePayslip);
const mockedConfirm = vi.mocked(confirmPayslip);

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function payslip(overrides: Partial<PayslipDetailResponse> = {}): PayslipDetailResponse {
  return {
    id: ID,
    sessionId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
    status: "review",
    tablesStatus: "ready",
    pageCount: 1,
    currency: "EUR",
    warnings: [],
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:00.000Z",
    employerName: "Poslodavac d.o.o.",
    employeeName: "Ana Horvat",
    period: "2025-03",
    brutoPlaca: "1300.00",
    netoPlaca: "1040.00",
    payComponents: [
      { naziv: "REDOVAN RAD", sati: "168.00", koeficijent: null, iznos: "1200.00" },
      { naziv: "NOĆNI RAD", sati: "8.00", koeficijent: null, iznos: "100.00" },
    ],
    obustave: [],
    neoporeziviPrimici: [],
    lowConfidenceFields: [],
    unreadableFields: [],
    ungroundableFields: [],
    editedFields: [],
    ...overrides,
  };
}

function stubWide(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

function renderForm(detail = payslip(), initialEdits?: UnsavedEdits) {
  const props = {
    onSaved: vi.fn(),
    onConfirmed: vi.fn(),
    onDirtyChange: vi.fn(),
    onFieldFocus: vi.fn(),
    onClose: vi.fn(),
    initialEdits,
  };
  const view = render(
    <ToastProvider>
      <PayslipForm detail={detail} {...props} />
    </ToastProvider>,
  );
  const rerender = (next: PayslipDetailResponse) =>
    view.rerender(
      <ToastProvider>
        <PayslipForm detail={next} {...props} />
      </ToastProvider>,
    );
  return { ...view, props, rerender };
}

const byId = (path: string) =>
  document.getElementById(`review-field-${path.replaceAll(".", "-")}`) as HTMLInputElement;
const save = () => userEvent.click(screen.getByRole("button", { name: "Save changes" }));
const confirmButton = () => screen.getByRole("button", { name: "Confirm payslip" });

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  stubWide(true);
  mockedUpdate.mockImplementation((_id, body) => Promise.resolve(payslip(body)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PayslipForm", () => {
  it("restores a scalar and saves only that key", async () => {
    const { props } = renderForm(payslip(), {
      values: toFormValues(payslip({ netoPlaca: "999.99" }), "en"),
      dirtyKeys: ["netoPlaca"],
    });
    expect(byId("netoPlaca")).toHaveValue("999.99");
    await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(true));
    await save();
    expect(mockedUpdate).toHaveBeenCalledWith(ID, { netoPlaca: "999.99" });
  });

  it("restores removed table rows and sends the whole table", async () => {
    const row = { naziv: "KREDIT", iznos: "20.00" };
    renderForm(payslip({ obustave: [row, row] }), {
      values: toFormValues(payslip({ obustave: [row] }), "en"),
      dirtyKeys: ["obustave"],
    });
    expect(byId("obustave.0.iznos")).toHaveValue("20.00");
    expect(byId("obustave.1.iznos")).toBeNull();
    await save();
    expect(mockedUpdate).toHaveBeenCalledWith(ID, {
      obustave: [{ ...row, vjerovnik: null, ostatakSalda: null, brojRata: null }],
    });
  });

  it("hands over typed values on unmount, without treating callback changes as a close", async () => {
    const { props, rerender, unmount } = renderForm();
    await userEvent.type(byId("employeeName"), "x");
    rerender(payslip());
    expect(props.onClose).not.toHaveBeenCalled();
    unmount();
    expect(props.onClose).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ employeeName: "Ana Horvatx" }),
        dirtyKeys: ["employeeName"],
      }),
    );
  });

  it("closes cleanly after a successful save", async () => {
    const { props, unmount } = renderForm();
    await userEvent.type(byId("employeeName"), "x");
    await save();
    await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(false));
    unmount();
    expect(props.onClose).toHaveBeenLastCalledWith(null);
  });

  it("keeps restored scalar edits when the tables land", async () => {
    const { rerender } = renderForm(
      payslip({ tablesStatus: "pending", payComponents: undefined }),
      {
        values: toFormValues(payslip({ netoPlaca: "999.99" }), "en"),
        dirtyKeys: ["netoPlaca"],
      },
    );
    rerender(payslip());
    await waitFor(() => expect(byId("payComponents.1.iznos")).toHaveValue("100.00"));
    expect(byId("netoPlaca")).toHaveValue("999.99");
  });

  it("restores under StrictMode and marks the action bar for keyboard hiding", async () => {
    const onDirtyChange = vi.fn();
    render(
      <StrictMode>
        <ToastProvider>
          <PayslipForm
            detail={payslip()}
            initialEdits={{
              values: toFormValues({ netoPlaca: "999.99" }, "en"),
              dirtyKeys: ["netoPlaca"],
            }}
            onSaved={vi.fn()}
            onConfirmed={vi.fn()}
            onDirtyChange={onDirtyChange}
            onFieldFocus={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(byId("netoPlaca")).toHaveValue("999.99");
    expect(
      screen.getByRole("button", { name: "Save changes" }).closest("[data-hide-with-keyboard]"),
    ).not.toBeNull();
  });
  it("renders an editable control with a stable id for every scalar and every cell", () => {
    renderForm();

    for (const path of [
      "employerName",
      "employeeIban",
      "paymentDate",
      "brutoPlaca",
      "ukupanTrosakRada",
      "payComponents.1.iznos",
    ]) {
      expect(byId(path), path).toBeInstanceOf(HTMLInputElement);
    }
    expect(byId("payComponents.0.naziv")).toBeInstanceOf(HTMLTextAreaElement);
    expect(byId("netoPlaca")).toHaveValue("1040.00");
  });

  it("shows decimals in the Croatian form when the UI is Croatian", async () => {
    await i18n.changeLanguage("hr");
    renderForm();

    expect(byId("netoPlaca")).toHaveValue("1040,00");
    expect(byId("period")).toHaveValue("03/2025");
  });

  it("saves only the edited scalar, parsed, and reports the save", async () => {
    const { props } = renderForm();

    await userEvent.clear(byId("netoPlaca"));
    await userEvent.type(byId("netoPlaca"), "1.041,00");
    await save();

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith(ID, { netoPlaca: "1041.00" }));
    expect(props.onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
  });

  it("sends a table whole when one of its cells changes", async () => {
    renderForm();

    await userEvent.clear(byId("payComponents.1.iznos"));
    await userEvent.type(byId("payComponents.1.iznos"), "101.00");
    await save();

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(ID, {
        payComponents: [
          { naziv: "REDOVAN RAD", sati: "168.00", koeficijent: null, iznos: "1200.00" },
          { naziv: "NOĆNI RAD", sati: "8.00", koeficijent: null, iznos: "101.00" },
        ],
      }),
    );
  });

  it("sends a table whose last row was removed", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    await save();

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(ID, {
        payComponents: [
          { naziv: "REDOVAN RAD", sati: "168.00", koeficijent: null, iznos: "1200.00" },
        ],
      }),
    );
  });

  it("shows the tables as a skeleton while pending, and never sends them", async () => {
    renderForm(payslip({ tablesStatus: "pending" }));

    expect(byId("payComponents.0.naziv")).toBeNull();
    await userEvent.type(byId("employerName"), " grupa");
    await save();

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(ID, { employerName: "Poslodavac d.o.o. grupa" }),
    );
  });

  it("holds Confirm while the form is dirty and says why, without disabling it", async () => {
    renderForm();

    await userEvent.type(byId("employerName"), "x");

    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    expect(confirmButton()).not.toBeDisabled();
    expect(confirmButton()).toHaveAccessibleDescription("Save your changes before confirming.");
    await userEvent.click(confirmButton());
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("reports clean once it unmounts, so a closed review cannot stay dirty", async () => {
    const { props, unmount } = renderForm();
    await userEvent.type(byId("employerName"), "x");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);

    unmount();

    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("holds Confirm while the tables pass is pending and says why", async () => {
    renderForm(payslip({ tablesStatus: "pending" }));

    expect(confirmButton()).toHaveAccessibleDescription(
      "You can confirm once the line items have been read.",
    );
    await userEvent.click(confirmButton());
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("confirms a payslip with a missing critical field and a warning", async () => {
    mockedConfirm.mockResolvedValue({
      id: ID,
      status: "confirmed",
      confirmedAt: "2026-09-26T11:00:00.000Z",
    });
    const { props } = renderForm(
      payslip({
        employeeName: null,
        warnings: [{ code: "missing_critical_field", field: "employeeName" }],
      }),
    );

    await userEvent.click(confirmButton());

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith(ID));
    expect(props.onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed" }),
    );
    await save();
    expect(mockedUpdate).toHaveBeenCalled();
  });

  it("shows Confirmed instead of the button once confirmed", () => {
    renderForm(payslip({ status: "confirmed" }));

    expect(screen.queryByRole("button", { name: "Confirm payslip" })).not.toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("names an invalid amount in a card, focuses it, and sends nothing", async () => {
    stubWide(false);
    renderForm();

    const amount = byId("payComponents.0.iznos");
    await userEvent.clear(amount);
    await userEvent.type(amount, "abc");
    await save();

    expect(await screen.findByText("Enter an amount, such as 1234.56.")).toBeVisible();
    expect(amount).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some values could not be read. Fix the marked fields, then save.",
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("marks a warned field amber with its note, and never aria-invalid", () => {
    renderForm(payslip({ warnings: [{ code: "neto_mismatch", field: "netoPlaca" }] }));

    const neto = byId("netoPlaca");
    expect(neto).toHaveClass("border-amber-500");
    expect(neto).not.toHaveAttribute("aria-invalid");
    expect(neto).toHaveAccessibleDescription("Dohodak minus income tax does not equal net pay.");
  });

  it("shows only the warning when a field is also low confidence", () => {
    renderForm(
      payslip({
        warnings: [{ code: "neto_mismatch", field: "netoPlaca" }],
        lowConfidenceFields: ["netoPlaca"],
      }),
    );

    expect(screen.queryByText("This value may need extra checking.")).not.toBeInTheDocument();
  });

  it("marks a format error aria-invalid and describes it", async () => {
    renderForm();

    await userEvent.clear(byId("paymentDate"));
    await userEvent.type(byId("paymentDate"), "not a date");
    await save();

    expect(await screen.findByText("Enter a date as YYYY-MM-DD.")).toBeInTheDocument();
    expect(byId("paymentDate")).toHaveAttribute("aria-invalid", "true");
    expect(byId("paymentDate")).toHaveAccessibleDescription("Enter a date as YYYY-MM-DD.");
  });

  it("says specifically when the tables became pending before a save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedUpdate.mockRejectedValue(new ApiError(409, "tables_pending"));
    renderForm();

    await userEvent.type(byId("employerName"), "x");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The line items are still being read, so they cannot be changed yet.",
    );
  });

  it("keeps a dirty scalar's typed text when the tables land", async () => {
    const { rerender, props } = renderForm(
      payslip({ tablesStatus: "pending", payComponents: undefined }),
    );

    await userEvent.clear(byId("netoPlaca"));
    await userEvent.type(byId("netoPlaca"), "999.99");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);

    rerender(payslip());

    await waitFor(() => expect(byId("payComponents.1.iznos")).toHaveValue("100.00"));
    expect(byId("netoPlaca")).toHaveValue("999.99");
  });

  it("reports the focused field's path, and null once focus leaves the form", async () => {
    const { props } = renderForm();

    await userEvent.click(byId("obustaveUkupno"));
    expect(props.onFieldFocus).toHaveBeenLastCalledWith("obustaveUkupno");
    await userEvent.click(byId("payComponents.1.iznos"));
    expect(props.onFieldFocus).toHaveBeenLastCalledWith("payComponents.1.iznos");
    await userEvent.click(document.body);
    expect(props.onFieldFocus).toHaveBeenLastCalledWith(null);
  });
});
