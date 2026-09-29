import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_OPEN, useOpenSections } from "./openSections";

describe("useOpenSections (Task 15 D9, Task 15b D8)", () => {
  it("starts with the scalar sections open and the tables closed", () => {
    const { result } = renderHook(() => useOpenSections());

    expect(result.current.open).toEqual(DEFAULT_OPEN);
    expect(DEFAULT_OPEN.employer).toBe(true);
    expect(DEFAULT_OPEN.obustave).toBe(false);
  });

  it("starts from the defaults on every mount", () => {
    const first = renderHook(() => useOpenSections());
    act(() => first.result.current.setOpen("obustave", true));
    act(() => first.result.current.setOpen("employer", false));
    expect(first.result.current.open).toMatchObject({ obustave: true, employer: false });
    first.unmount();

    const { result } = renderHook(() => useOpenSections());
    expect(result.current.open).toEqual(DEFAULT_OPEN);
  });

  it("opens several sections at once", () => {
    const { result } = renderHook(() => useOpenSections());

    act(() => result.current.openAll(["payComponents", "neoporeziviPrimici"]));

    expect(result.current.open).toMatchObject({ payComponents: true, neoporeziviPrimici: true });
    expect(result.current.open.obustave).toBe(false);
  });
});
