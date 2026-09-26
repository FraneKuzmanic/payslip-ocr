import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipSummary } from "@payslip/shared";
import i18n from "../i18n";
import { resetDismissedSuggestions } from "./dismissedSuggestions";
import { MergeSuggestions } from "./MergeSuggestions";

function summary(id: string): PayslipSummary {
  return {
    id,
    status: "review",
    tablesStatus: "ready",
    period: "2025-03",
    employeeName: null,
    pageCount: 1,
    failureReason: null,
    warningCount: 0,
    originalFilename: `${id}.jpg`,
  };
}

const payslips = [summary("a"), summary("b"), summary("c")];

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  resetDismissedSuggestions();
});

describe("MergeSuggestions (plan 11 D11)", () => {
  it("names each pair by rail position and opens its review", () => {
    const onReview = vi.fn();
    render(<MergeSuggestions pairs={[["b", "c"]]} payslips={payslips} onReview={onReview} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Payslips 2 and 3 look like pages of one payslip.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Review merge" }));
    expect(onReview).toHaveBeenCalledWith(["b", "c"]);
  });

  it("hides a dismissed pair, including after a remount", () => {
    const { unmount } = render(
      <MergeSuggestions pairs={[["a", "b"]]} payslips={payslips} onReview={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).toBeNull();

    unmount();
    render(<MergeSuggestions pairs={[["a", "b"]]} payslips={payslips} onReview={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("skips a pair whose payslip is no longer listed", () => {
    render(
      <MergeSuggestions
        pairs={[
          ["a", "gone"],
          ["a", "c"],
        ]}
        payslips={payslips}
        onReview={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Payslips 1 and 3");
  });
});
