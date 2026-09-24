import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceOverlay } from "./SourceOverlay";

const regions = [
  {
    fields: ["total", "currency"],
    page: 1,
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.2 },
      { x: 0.1, y: 0.2 },
    ],
    origin: "model" as const,
  },
];

describe("SourceOverlay", () => {
  it("renders accessible decoration and selects the canonical field", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SourceOverlay
        regions={regions}
        page={1}
        activeField="total"
        editedFields={[]}
        onSelect={onSelect}
      />,
    );

    const overlay = container.querySelector("svg");
    const outline = container.querySelector("polygon");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(outline).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(outline).toHaveAttribute("stroke-width", "2.5");
    fireEvent.click(outline!);
    expect(onSelect).toHaveBeenCalledWith("total");
  });

  it("keeps an inactive region's whole area clickable, not just its stroke", () => {
    // A real browser only fires a pointer event where something is actually painted. An inactive
    // region's `fill` is fully transparent, so `fill="none"` would leave only the ~1px stroke
    // line hit-testable — a click anywhere in the middle of the box would silently miss. Caught by
    // driving a real browser, not by this test alone: `fireEvent.click` dispatches directly on the
    // element and does not perform real hit-testing, so it cannot fail this on its own.
    const { container } = render(
      <SourceOverlay
        regions={regions}
        page={1}
        activeField={null}
        editedFields={[]}
        onSelect={vi.fn()}
      />,
    );
    const outline = container.querySelector("polygon");
    expect(outline).not.toHaveAttribute("fill", "none");
    expect(outline).toHaveStyle({ pointerEvents: "all" });
  });

  it("dashes a region's outline once its value has been edited since extraction", () => {
    const { container, rerender } = render(
      <SourceOverlay
        regions={regions}
        page={1}
        activeField={null}
        editedFields={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("polygon")).not.toHaveAttribute("stroke-dasharray");

    rerender(
      <SourceOverlay
        regions={regions}
        page={1}
        activeField={null}
        editedFields={["total"]}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("polygon")).toHaveAttribute("stroke-dasharray", "5,3");
  });
});
