import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipSummary } from "@payslip/shared";
import i18n from "../i18n";
import { resetDismissedSuggestions } from "./dismissedSuggestions";
import { MergeSuggestions, shortName } from "./MergeSuggestions";

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

describe("shortName", () => {
  it("keeps a name of up to 40 characters whole", () => {
    expect(shortName("lipanj.pdf")).toBe("lipanj.pdf");
    expect(shortName("x".repeat(36) + ".pdf")).toBe("x".repeat(36) + ".pdf");
  });

  it("elides the middle of a long name and keeps its extension", () => {
    const name = "very_long_" + "a".repeat(180) + "_scan.jpg";
    const short = shortName(name);
    expect(short).toHaveLength(40);
    expect(short.startsWith("very_long_")).toBe(true);
    expect(short.endsWith("_scan.jpg")).toBe(true);
    expect(short).toContain("…");
  });

  it("elides a long name without an extension", () => {
    const short = shortName("b".repeat(60));
    expect(short).toHaveLength(40);
    expect(short).toContain("…");
  });
});

describe("MergeSuggestions (plan 11 D11)", () => {
  it("names each pair by file name and opens its review (Task 14 D11)", () => {
    const onReview = vi.fn();
    render(<MergeSuggestions pairs={[["b", "c"]]} payslips={payslips} onReview={onReview} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "b.jpg and c.jpg look like pages of one payslip.",
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
    expect(screen.getByRole("status")).toHaveTextContent("a.jpg and c.jpg");
  });
});
