import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TablesStatus } from "@payslip/shared";
import i18n from "../i18n";
import type { AttentionSignals } from "./fieldAttention";
import { LineItemSection } from "./LineItemSection";
import { toFormValues, type ReviewFormValues } from "./reviewForm";

function stubWide(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

const values = toFormValues(
  {
    payComponents: [
      { naziv: "REDOVAN RAD", sati: "168.00", koeficijent: null, iznos: "1800.00" },
      { naziv: "NOĆNI RAD", sati: "8.00", koeficijent: null, iznos: "40.00" },
    ],
  },
  "en",
);
const none: AttentionSignals = { warnings: [], lowConfidenceFields: [], ungroundableFields: [] };

function Harness({
  tablesStatus = "ready",
  signals = none,
}: {
  tablesStatus?: TablesStatus;
  signals?: AttentionSignals;
}) {
  const { control, register, handleSubmit, formState } = useForm<ReviewFormValues>({
    defaultValues: values,
  });
  return (
    <form onSubmit={handleSubmit(() => {})}>
      <LineItemSection
        table="payComponents"
        control={control}
        register={register}
        tablesStatus={tablesStatus}
        signals={signals}
        errors={formState.errors}
      />
      <button type="submit">Save</button>
    </form>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LineItemSection", () => {
  it("renders a real table at lg, and no cards", () => {
    stubWide(true);
    render(<Harness />);

    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Component", "Hours", "Coefficient", "Amount"]);
    expect(screen.getByRole("textbox", { name: "Amount, Pay components row 2" })).toHaveValue(
      "40.00",
    );
    expect(screen.queryByText("Pay components row 1")).not.toBeInTheDocument();
  });

  it("renders cards on a phone, and no table", () => {
    stubWide(false);
    render(<Harness />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Pay components row 1")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Amount" })).toHaveLength(2);
  });

  it("gives every cell its stable review-field id", () => {
    stubWide(true);
    const { container } = render(<Harness />);

    expect(container.querySelector("#review-field-payComponents-1-iznos")).toHaveValue("40.00");
  });

  it("shows a read-only skeleton while the tables pass is pending", () => {
    stubWide(true);
    render(<Harness tablesStatus="pending" />);

    expect(screen.getByRole("status")).toHaveTextContent("Line items still loading");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add row" })).not.toBeInTheDocument();
  });

  it("says the tables failed, and still lets rows be added by hand", async () => {
    stubWide(false);
    render(<Harness tablesStatus="failed" />);

    expect(
      screen.getByText("The line items could not be read. Add them by hand if you need them."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(screen.getByText("Pay components row 3")).toBeInTheDocument();
  });

  it("removes a row through a named 48 px button", async () => {
    stubWide(true);
    render(<Harness />);

    const remove = screen.getByRole("button", { name: "Remove row 1" });
    expect(remove).toHaveClass("size-12");
    await userEvent.click(remove);
    expect(screen.getByRole("textbox", { name: "Component, Pay components row 1" })).toHaveValue(
      "NOĆNI RAD",
    );
  });

  it.each([
    ["at lg", true, "Amount, Pay components row 1"],
    ["on a phone", false, "Amount"],
  ] as const)("shows an invalid amount's message visibly %s", async (_name, wide, label) => {
    stubWide(wide);
    render(<Harness />);

    const amount = screen.getAllByRole("textbox", { name: label })[0]!;
    await userEvent.clear(amount);
    await userEvent.type(amount, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter an amount, such as 1234.56.")).toBeVisible();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription(/Enter an amount, such as 1234\.56\./);
    expect(amount).toHaveFocus();
  });

  it("marks a flagged cell amber with its note, without aria-invalid", () => {
    stubWide(true);
    render(<Harness signals={{ ...none, lowConfidenceFields: ["payComponents.0.sati"] }} />);

    const hours = screen.getByRole("textbox", { name: "Hours, Pay components row 1" });
    expect(hours).toHaveClass("border-amber-500");
    expect(hours).not.toHaveAttribute("aria-invalid");
    expect(hours).toHaveAccessibleDescription(/This value may need extra checking\./);
  });

  it("shows a warning about the whole table under its legend", () => {
    stubWide(true);
    render(
      <Harness
        signals={{
          ...none,
          warnings: [{ code: "pay_components_sum_mismatch", field: "payComponents" }],
        }}
      />,
    );

    expect(screen.getByText("The pay components do not add up to gross pay.")).toBeInTheDocument();
  });
});
