import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { RegionPopover } from "./RegionPopover";

function renderPopover(overrides: Partial<Parameters<typeof RegionPopover>[0]> = {}) {
  const props = {
    field: "netoPlaca",
    value: "2298.97",
    lowConfidence: false,
    ungroundable: false,
    unreadable: false,
    edited: false,
    top: 120,
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<RegionPopover {...props} />);
  return { props, ...view };
}

describe("RegionPopover", () => {
  it("shows the field label and its current value without taking focus", () => {
    renderPopover();

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Net pay");
    expect(screen.getByText("2298.97")).toBeInTheDocument();
    // The whole point of the popover: reading the source must not raise the software keyboard,
    // which is what focusing the input did and what hid the crop strip on a real phone.
    expect(document.activeElement).toBe(document.body);
  });

  it("reports an empty extraction rather than rendering a blank card", () => {
    renderPopover({ value: null });
    expect(screen.getByText("No value was read here.")).toBeInTheDocument();
  });

  it("repeats the low-confidence hint only when the field carries it", () => {
    const { unmount } = renderPopover();
    expect(screen.queryByText("This value may need extra checking.")).not.toBeInTheDocument();
    unmount();

    renderPopover({ lowConfidence: true });
    expect(screen.getByText("This value may need extra checking.")).toBeInTheDocument();
  });

  it("notes an ungroundable value and an unreadable one", () => {
    const { unmount } = renderPopover();
    expect(screen.queryByText(/not found in the page's text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be read as a value/)).not.toBeInTheDocument();
    unmount();

    renderPopover({ ungroundable: true, unreadable: true, value: null });
    expect(
      screen.getByText(
        "This value was not found in the page's text. Check it against the document.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Text was found here, but it could not be read as a value."),
    ).toBeInTheDocument();
    expect(screen.getByText("No value was read here.")).toBeInTheDocument();
  });

  it("shows an edited tag only once the value differs from the original extraction", () => {
    renderPopover();
    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
    renderPopover({ edited: true });
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("labels a table cell by its column, section and 1-based row", () => {
    renderPopover({ field: "obustave.1.iznos" });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Amount, Obustave row 2");
  });

  it("falls back to the document title for a path it has no label for", () => {
    renderPopover({ field: "unknown" });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Original payslip");
  });

  it("offers no Edit button without an input to focus (Task 08 D2)", () => {
    renderPopover();
    expect(screen.queryByRole("button", { name: "Edit this field" })).not.toBeInTheDocument();
  });

  it("edits and closes through explicit actions", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { props } = renderPopover({ onEdit });

    await user.click(screen.getByRole("button", { name: "Edit this field" }));
    expect(onEdit).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
