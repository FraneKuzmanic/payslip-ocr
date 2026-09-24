import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { RegionPopover } from "./RegionPopover";

function renderPopover(overrides: Partial<Parameters<typeof RegionPopover>[0]> = {}) {
  const props = {
    field: "total",
    value: "103.69",
    lowConfidence: false,
    edited: false,
    top: 120,
    onEdit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<RegionPopover {...props} />);
  return props;
}

describe("RegionPopover", () => {
  it("shows the field label and its current value without taking focus", () => {
    renderPopover();

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Total");
    expect(screen.getByText("103.69")).toBeInTheDocument();
    // The whole point of the popover: reading the source must not raise the software keyboard,
    // which is what focusing the input did and what hid the crop strip on a real phone.
    expect(document.activeElement).toBe(document.body);
  });

  it("reports an empty extraction rather than rendering a blank card", () => {
    renderPopover({ value: null });
    expect(screen.getByText("No value was read here.")).toBeInTheDocument();
  });

  it("repeats the low-confidence hint only when the field carries it", () => {
    const { unmount } = render(
      <RegionPopover
        field="total"
        value="103.69"
        lowConfidence={false}
        edited={false}
        top={0}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("This value may need extra checking.")).not.toBeInTheDocument();
    unmount();

    renderPopover({ lowConfidence: true });
    expect(screen.getByText("This value may need extra checking.")).toBeInTheDocument();
  });

  it("shows an edited tag only once the value differs from the original extraction", () => {
    renderPopover();
    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
    renderPopover({ edited: true });
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("labels nested VAT and item paths from their leaf field", () => {
    renderPopover({ field: "vatBreakdown.0.taxableBase" });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Taxable base");
  });

  it("edits and closes through explicit actions", async () => {
    const user = userEvent.setup();
    const props = renderPopover();

    await user.click(screen.getByRole("button", { name: "Edit this field" }));
    expect(props.onEdit).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
