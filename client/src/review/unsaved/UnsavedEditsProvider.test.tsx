import { act, render, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { toFormValues } from "../reviewForm";
import type { UnsavedEditsContextValue } from "./UnsavedEditsContext";
import { UnsavedEditsProvider } from "./UnsavedEditsProvider";
import { useUnsavedEdits } from "./useUnsavedEdits";

function mount() {
  let current: UnsavedEditsContextValue;
  function Probe() {
    current = useUnsavedEdits();
    return null;
  }
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<UnsavedEditsProvider />}>
          <Route index element={<Probe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return () => current;
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("UnsavedEditsProvider", () => {
  it("marks membership and guards reload only while edits are unsaved", () => {
    const edits = mount();
    expect(unload()).toBe(false);
    act(() => edits().markUnsaved("a", true));
    expect(edits().unsaved.has("a")).toBe(true);
    expect(unload()).toBe(true);
    const membership = edits().unsaved;
    act(() => edits().markUnsaved("a", true));
    expect(edits().unsaved).toBe(membership);
    act(() => edits().markUnsaved("a", false));
    expect(unload()).toBe(false);
  });

  it("hands over stored edits once, retaining membership until saved or cleared", () => {
    const edits = mount();
    const saved = {
      values: toFormValues({ netoPlaca: "42.00" }, "en"),
      dirtyKeys: ["netoPlaca"] as const,
    };
    act(() => edits().keep("a", saved));
    expect(edits().take("a")).toBe(saved);
    expect(edits().take("a")).toBeUndefined();
    expect(edits().unsaved.has("a")).toBe(true);
    act(() => edits().keep("a", null));
    expect(edits().unsaved.size).toBe(0);
    expect(unload()).toBe(false);
  });

  it("requires the provider", () => {
    expect(() => renderHook(useUnsavedEdits)).toThrow(
      "useUnsavedEdits must be used inside UnsavedEditsProvider",
    );
  });
});
