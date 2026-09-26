import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipSummary } from "@payslip/shared";
import i18n from "../i18n";
import { PayslipRail } from "./PayslipRail";

const payslips: PayslipSummary[] = ["a", "b", "c"].map((id, index) => ({
  id,
  status: "review",
  tablesStatus: "ready",
  period: index === 0 ? "2025-07" : null,
  employeeName: null,
  pageCount: 1,
  failureReason: null,
  warningCount: 0,
  originalFilename: `${id}.pdf`,
}));
function mount(orientation: "horizontal" | "vertical" = "horizontal") {
  const onSelect = vi.fn();
  render(
    <PayslipRail
      payslips={payslips}
      selectedId="a"
      unsaved={new Set(["b"])}
      orientation={orientation}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => vi.unstubAllGlobals());
describe("PayslipRail", () => {
  it("names every tab, exposes status and marks selection and unsaved edits", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    expect(tabs[0]).toHaveTextContent("2025-07");
    expect(tabs[1]).toHaveTextContent("b.pdf");
    expect(tabs[1]).toHaveTextContent("Unsaved changes");
    expect(tabs[0]).not.toHaveTextContent("Unsaved changes");
    for (const tab of tabs) {
      expect(tab).toHaveTextContent("Ready to review");
      expect(tab).toHaveClass("min-h-12");
    }
  });
  it.each(["horizontal", "vertical"] as const)(
    "moves focus without selecting in %s orientation",
    (orientation) => {
      const select = mount(orientation);
      const tabs = screen.getAllByRole("tab");
      tabs[0]!.focus();
      fireEvent.keyDown(tabs[0]!, { key: orientation === "horizontal" ? "ArrowLeft" : "ArrowUp" });
      expect(tabs[2]).toHaveFocus();
      fireEvent.keyDown(tabs[2]!, {
        key: orientation === "horizontal" ? "ArrowRight" : "ArrowDown",
      });
      expect(tabs[0]).toHaveFocus();
      fireEvent.keyDown(tabs[0]!, { key: "End" });
      expect(tabs[2]).toHaveFocus();
      fireEvent.keyDown(tabs[2]!, { key: "Home" });
      expect(tabs[0]).toHaveFocus();
      expect(select).not.toHaveBeenCalled();
      expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", orientation);
    },
  );
  it("activates through Enter and Space", async () => {
    const select = mount();
    screen.getAllByRole("tab")[1]!.focus();
    await userEvent.keyboard("{Enter} ");
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith("b");
  });
  it("formats the period in Croatian", async () => {
    await i18n.changeLanguage("hr");
    mount();
    expect(screen.getAllByRole("tab")[0]).toHaveTextContent("07/2025");
  });
  it("puts the overflow count on the last fully visible chip", () => {
    let update: IntersectionObserverCallback;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          update = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    mount();
    const tabs = screen.getAllByRole("tab");
    act(() =>
      update!(
        tabs.map((target, index) => ({
          target,
          intersectionRatio: index < 2 ? 1 : 0.2,
          boundingClientRect: new DOMRect(),
          intersectionRect: new DOMRect(),
          isIntersecting: true,
          rootBounds: null,
          time: 0,
        })),
        {} as IntersectionObserver,
      ),
    );
    expect(tabs[1]).toHaveTextContent("+1");
    expect(screen.getByText("+1")).toHaveAttribute("aria-hidden", "true");
  });
});
