import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSoftKeyboard } from "./useSoftKeyboard";

function pointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches: coarse,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("useSoftKeyboard", () => {
  it("does not hide controls for a fine pointer", () => {
    pointer(false);
    const { result } = renderHook(() => useSoftKeyboard("netoPlaca"));
    expect(result.current).toBe(false);
    expect(document.documentElement).not.toHaveAttribute("data-keyboard");
  });
  it("enters on focus and cleans up on blur and unmount", () => {
    pointer(true);
    const { result, rerender, unmount } = renderHook(
      ({ path }: { path: string | null }) => useSoftKeyboard(path),
      { initialProps: { path: "netoPlaca" as string | null } },
    );
    expect(result.current).toBe(true);
    expect(document.documentElement).toHaveAttribute("data-keyboard", "open");
    rerender({ path: null });
    expect(document.documentElement).not.toHaveAttribute("data-keyboard");
    rerender({ path: "period" });
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-keyboard");
    expect(document.documentElement.style.getPropertyValue("--visual-top")).toBe("");
  });
  it("tracks the visual offset and scrolls an obscured input only on the first resize", () => {
    pointer(true);
    const viewport = Object.assign(new EventTarget(), { offsetTop: 100, height: 300 });
    vi.stubGlobal("visualViewport", viewport);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({ top: 120, bottom: 168 } as DOMRect);
    input.scrollIntoView = vi.fn();
    const { unmount } = renderHook(() => useSoftKeyboard("period"));
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(input.scrollIntoView).toHaveBeenCalledOnce();
    act(() => {
      viewport.offsetTop = 140;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(document.documentElement.style.getPropertyValue("--visual-top")).toBe("140px");
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(input.scrollIntoView).toHaveBeenCalledOnce();
    unmount();
    input.remove();
    act(() => viewport.dispatchEvent(new Event("scroll")));
    expect(document.documentElement.style.getPropertyValue("--visual-top")).toBe("");
  });
});
