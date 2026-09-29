import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DisclosureButton } from "./DisclosureButton";

describe("DisclosureButton (Task 15 D10)", () => {
  it("is a button that states and toggles its region", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DisclosureButton expanded={false} controls="region" onToggle={onToggle}>
        Details
      </DisclosureButton>,
    );

    const button = screen.getByRole("button", { name: "Details" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "region");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <DisclosureButton expanded controls="region" onToggle={onToggle}>
        Details
      </DisclosureButton>,
    );
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});
