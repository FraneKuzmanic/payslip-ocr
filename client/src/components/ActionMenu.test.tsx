import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { ActionMenu } from "./ActionMenu";

function renderMenu(onSelect = vi.fn()) {
  render(
    <ActionMenu
      id="test-menu"
      label="Payslip actions"
      items={[{ key: "delete", label: "Delete", icon: Trash2, onSelect, destructive: true }]}
    />,
  );
  return { onSelect, trigger: screen.getByRole("button", { name: "Payslip actions" }) };
}

describe("ActionMenu", () => {
  it("opens on the trigger and reports its state", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "test-menu");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("runs an item, closes, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { onSelect, trigger } = renderMenu();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape without running anything", async () => {
    const user = userEvent.setup();
    const { onSelect, trigger } = renderMenu();

    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside pointer without returning focus", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();

    await user.click(trigger);
    await user.click(document.body);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveFocus();
  });

  it("swaps the trigger glyph for a spinner while busy, keeping the menu reachable", () => {
    render(
      <ActionMenu
        id="busy-menu"
        label="Payslip actions"
        busy
        items={[{ key: "delete", label: "Delete", icon: Trash2, onSelect: vi.fn() }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Payslip actions" });
    expect(trigger).toBeEnabled();
    expect(trigger.querySelector(".animate-spin")).not.toBeNull();
  });
});
