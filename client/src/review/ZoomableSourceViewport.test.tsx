import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ZoomableSourceViewport, type SourceFit } from "./ZoomableSourceViewport";

const regions = [
  {
    fields: ["netoPlaca"],
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

function renderViewport(onSelect?: (field: string) => void, fit: SourceFit = "page") {
  return render(
    <ZoomableSourceViewport
      ratio={0.8}
      fit={fit}
      overlaySafe
      regions={regions}
      page={1}
      activeField={null}
      interaction="popover"
      fieldValues={{ netoPlaca: "2298.97" }}
      lowConfidenceFields={[]}
      ungroundableFields={[]}
      unreadableFields={[]}
      editedFields={[]}
      onSelect={onSelect}
    >
      {() => <span />}
    </ZoomableSourceViewport>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

/**
 * jsdom lays nothing out, so the frame reports the size a 600 px column with a 500 px height budget
 * would. At ratio 0.8 the page at that width is 600 × 750, taller than its frame (Task 14 D17).
 */
function stubFrame(width = 600, height = 500) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, width, height),
  );
}

/** The frame is the element that carries the pointer handlers: the transformed layer's parent. */
function frameOf(container: HTMLElement) {
  return layerOf(container).parentElement!;
}

function layerOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[style*='transform']")!;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ZoomableSourceViewport fit and gestures (Task 14)", () => {
  it("no longer shows the tap-a-highlight hint (D16)", () => {
    renderViewport(vi.fn());
    expect(screen.queryByText(/Tap a highlighted value/)).toBeNull();
  });

  it("sizes the layer to the page at the column's width when fitting the width (D17)", () => {
    stubFrame();
    const { container } = renderViewport(vi.fn(), "width");
    expect(layerOf(container).style.width).toBe("600px");
    expect(layerOf(container).style.height).toBe("750px");
    expect(frameOf(container).style.height).toBe("var(--source-height, 65svh)");
  });

  it("keeps the page's own box when fitting the page, in svh (D21)", () => {
    stubFrame(400, 500);
    const { container } = renderViewport(vi.fn(), "page");
    expect(frameOf(container).style.width).toBe("min(100%, var(--source-height, 65svh) * 0.8)");
    expect(layerOf(container).style.width).toBe("400px");
    expect(layerOf(container).style.height).toBe("500px");
  });

  it("zooms with a plain wheel about the cursor, and never lets the page scroll (Task 15 D8)", () => {
    stubFrame();
    const { container } = renderViewport(vi.fn(), "width");
    const frame = frameOf(container);

    const zoomIn = fireEvent.wheel(frame, { deltaY: -100, clientX: 300, clientY: 0 });
    expect(zoomIn).toBe(false); // consumed
    expect(screen.getByText("Zoom 150%")).toBeInTheDocument();

    fireEvent.wheel(frame, { deltaY: 100, clientX: 300, clientY: 0 });
    fireEvent.wheel(frame, { deltaY: 100, clientX: 300, clientY: 0 });
    expect(screen.getByText("Zoom 67%")).toBeInTheDocument();
    // At the whole page a further zoom-out changes nothing, and the page still does not scroll.
    const past = fireEvent.wheel(frame, { deltaY: 100, clientX: 300, clientY: 0 });
    expect(past).toBe(false);
    expect(screen.getByText("Zoom 67%")).toBeInTheDocument();
  });

  it("zooms with Ctrl + wheel about the cursor (D17)", () => {
    stubFrame();
    const { container } = renderViewport(vi.fn(), "width");
    fireEvent.wheel(frameOf(container), { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 0 });
    expect(screen.getByText("Zoom 150%")).toBeInTheDocument();
  });

  it("zooms out no further than the whole page, and resets to the page width at the top", async () => {
    stubFrame();
    const { container } = renderViewport(vi.fn(), "width");
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const reset = screen.getByRole("button", { name: "Fit to view" });
    expect(zoomOut).toBeEnabled();
    expect(reset).toBeDisabled();

    await userEvent.click(zoomOut);
    expect(screen.getByText("Zoom 67%")).toBeInTheDocument();
    expect(zoomOut).toBeDisabled();

    await userEvent.click(reset);
    expect(screen.getByText("Zoom 100%")).toBeInTheDocument();
    expect(layerOf(container).style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("disables zoom-out at fit when the page fits its frame", () => {
    stubFrame(400, 500);
    renderViewport(vi.fn(), "page");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });

  it("zooms the document when two fingers move apart, and the lift opens no outline (D19)", () => {
    vi.useFakeTimers();
    stubFrame(400, 500);
    const { container } = renderViewport(vi.fn(), "page");
    const frame = frameOf(container);
    expect(frame).toHaveClass("touch-pan-y");

    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 150, clientY: 200 });
    fireEvent.pointerDown(frame, { pointerId: 2, clientX: 250, clientY: 200 });
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: 350, clientY: 200 });
    expect(screen.getByText("Zoom 200%")).toBeInTheDocument();
    expect(frame).toHaveClass("touch-none");

    const polygon = container.querySelector("polygon")!;
    fireEvent.pointerUp(frame, { pointerId: 2 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    fireEvent.click(polygon);
    expect(screen.queryByRole("dialog")).toBeNull();

    // The suppression lasts for that one click only.
    act(() => vi.runAllTimers());
    fireEvent.click(polygon);
    expect(screen.getByRole("dialog", { name: "Net pay" })).toBeInTheDocument();
  });
});

describe("ZoomableSourceViewport's popover (Task 09 D9)", () => {
  it("closes on Escape without taking focus it did not have", async () => {
    const { container } = renderViewport(vi.fn());
    fireEvent.click(container.querySelector("polygon")!);
    expect(screen.getByRole("dialog", { name: "Net pay" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the viewport when Escape closes it with focus inside", async () => {
    const { container } = renderViewport(vi.fn());
    fireEvent.click(container.querySelector("polygon")!);
    screen.getByRole("button", { name: "Close" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("tabindex", "-1");
  });

  it("routes Edit to onSelect with the region's path", async () => {
    const onSelect = vi.fn();
    const { container } = renderViewport(onSelect);
    fireEvent.click(container.querySelector("polygon")!);

    await userEvent.click(screen.getByRole("button", { name: "Edit this field" }));

    expect(onSelect).toHaveBeenCalledWith("netoPlaca");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
