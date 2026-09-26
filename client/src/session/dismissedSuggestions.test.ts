import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetDismissedSuggestions,
  suggestionKey,
  useDismissedSuggestions,
} from "./dismissedSuggestions";

afterEach(() => {
  resetDismissedSuggestions();
});

describe("dismissed merge suggestions (plan 11 D6)", () => {
  it("keys a pair in the suggestion's order", () => {
    expect(suggestionKey(["a", "b"])).toBe("a:b");
  });

  it("shares a dismissal with every reader, including one mounted later", () => {
    const first = renderHook(() => useDismissedSuggestions());
    const second = renderHook(() => useDismissedSuggestions());

    act(() => first.result.current.dismiss("a:b"));

    expect(second.result.current.dismissed.has("a:b")).toBe(true);
    first.unmount();
    second.unmount();
    expect(renderHook(() => useDismissedSuggestions()).result.current.dismissed.has("a:b")).toBe(
      true,
    );
  });

  it("starts empty after a reset", () => {
    const { result } = renderHook(() => useDismissedSuggestions());
    act(() => result.current.dismiss("a:b"));

    act(() => resetDismissedSuggestions());

    expect(result.current.dismissed.size).toBe(0);
  });
});
