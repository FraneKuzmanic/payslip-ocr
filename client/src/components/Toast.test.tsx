import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const { show } = useToast();
  return <button onClick={() => show("Changes saved")}>Save</button>;
}

afterEach(() => vi.useRealTimers());

describe("ToastProvider", () => {
  it("keeps an empty status region mounted until a message is shown", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    const trigger = screen.getByRole("button", { name: "Save" });
    trigger.focus();
    await user.click(trigger);

    expect(region).toHaveTextContent("Changes saved");
    expect(trigger).toHaveFocus();
  });

  it("dismisses manually, with Escape, and after six seconds", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
