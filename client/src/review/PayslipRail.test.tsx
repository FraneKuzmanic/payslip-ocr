import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
function mount(list: readonly PayslipSummary[] = payslips) {
  const onSelect = vi.fn();
  render(
    <PayslipRail payslips={list} selectedId="a" unsaved={new Set(["b"])} onSelect={onSelect} />,
  );
  return onSelect;
}
function withStatus(id: string, status: PayslipSummary["status"]) {
  return payslips.map((payslip) => (payslip.id === id ? { ...payslip, status } : payslip));
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
describe("PayslipRail", () => {
  it("names every tab, exposes status and marks selection and unsaved edits", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    expect(tabs[1]).toHaveTextContent("Unsaved changes");
    expect(tabs[0]).not.toHaveTextContent("Unsaved changes");
    for (const tab of tabs) {
      expect(tab).toHaveTextContent("Ready to review");
      expect(tab).toHaveClass("min-h-12");
    }
  });
  it("shows the file name, with no position number and no period (Task 14 D10)", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.firstElementChild?.textContent)).toEqual([
      "a.pdf",
      "b.pdfUnsaved changes",
      "c.pdf",
    ]);
    expect(tabs[0]).not.toHaveTextContent("2025-07");
    expect(tabs[0]?.textContent?.startsWith("1")).toBe(false);
  });
  it("moves focus without selecting, horizontally", () => {
    const select = mount();
    const tabs = screen.getAllByRole("tab");
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2]!, { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2]!, { key: "Home" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowDown" });
    expect(tabs[0]).toHaveFocus();
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "horizontal");
  });
  it("activates through Enter and Space", async () => {
    const select = mount();
    screen.getAllByRole("tab")[1]!.focus();
    await userEvent.keyboard("{Enter} ");
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith("b");
  });
  it("reaches a processing chip by arrow but never opens it (Task 14 D10)", async () => {
    const select = mount(withStatus("b", "processing"));
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-disabled", "true");
    expect(tabs[1]).not.toBeDisabled();
    expect(tabs[1]).toHaveTextContent("Reading the payslip");
    expect(tabs[0]).toHaveAttribute("aria-disabled", "false");

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    await userEvent.keyboard("{Enter} ");
    await userEvent.click(tabs[1]!);
    expect(select).not.toHaveBeenCalled();
  });
  it("opens a failed chip", async () => {
    const select = mount(withStatus("c", "failed"));
    await userEvent.click(screen.getAllByRole("tab")[2]!);
    expect(select).toHaveBeenCalledWith("c");
  });
});
