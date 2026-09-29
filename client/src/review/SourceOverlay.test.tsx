import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OUTLINE_GAP_PX, SourceOverlay, padCorners } from "./SourceOverlay";

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

const pointsOf = (polygon: Element | null) =>
  polygon!
    .getAttribute("points")!
    .split(" ")
    .map((pair) => pair.split(",").map(Number));

describe("padCorners (Task 15 D13)", () => {
  it("grows each side of a rectangle by the pad", () => {
    const padded = padCorners(regions[0]!.corners, 0.01, 0.02);
    expect(padded[0]!.x).toBeCloseTo(0.09);
    expect(padded[0]!.y).toBeCloseTo(0.08);
    expect(padded[2]!.x).toBeCloseTo(0.31);
    expect(padded[2]!.y).toBeCloseTo(0.22);
  });

  it("still grows a quad of zero height", () => {
    const flat = [
      { x: 0.1, y: 0.5 },
      { x: 0.3, y: 0.5 },
      { x: 0.3, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ];
    const padded = padCorners(flat, 0.01, 0.01);
    expect(padded).toHaveLength(4);
    expect(padded[0]!.x).toBeCloseTo(0.09);
    expect(padded[2]!.x).toBeCloseTo(0.31);
  });
});

describe("SourceOverlay", () => {
  it("pads the outline outward by a constant screen gap, beside the text (Task 15 D13)", () => {
    const { container } = render(
      <SourceOverlay
        regions={regions}
        page={1}
        activeField={null}
        editedFields={[]}
        onSelect={vi.fn()}
        rendered={{ width: 300, height: 150 }}
      />,
    );
    const [first, , third] = pointsOf(container.querySelector("polygon"));
    expect(first![0]).toBeCloseTo(0.1 - OUTLINE_GAP_PX / 300);
    expect(first![1]).toBeCloseTo(0.1 - OUTLINE_GAP_PX / 150);
    expect(third![0]).toBeCloseTo(0.3 + OUTLINE_GAP_PX / 300);
    expect(third![1]).toBeCloseTo(0.2 + OUTLINE_GAP_PX / 150);
  });

  it("draws the quad itself without a rendered size, and a 1 px stroke at rest", () => {
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
    expect(pointsOf(outline)[0]).toEqual([0.1, 0.1]);
    expect(outline).toHaveAttribute("stroke-width", "1");
    expect(outline).toHaveAttribute("fill-opacity", "0");
  });

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
    expect(outline).toHaveAttribute("stroke-width", "2");
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

  it("draws an inactive outline at full opacity, so its colour keeps its 3:1 contrast", () => {
    // At the inherited 0.55 every section colour fell to 2.2–2.7:1 against white (Task 08 review).
    const { container } = render(
      <SourceOverlay
        regions={regions}
        page={1}
        activeField={null}
        editedFields={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("polygon")).toHaveAttribute("stroke-opacity", "1");
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
