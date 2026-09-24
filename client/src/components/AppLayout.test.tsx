import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthContext, type AuthContextValue } from "../auth/AuthContext";
import { AppLayout } from "./AppLayout";

const session = {
  access_token: "token",
  user: { email: "frane.kuzmanic@gmail.com" },
} as Session;

function renderLayout(options: { path?: string; value?: Partial<AuthContextValue> } = {}) {
  const signOut = vi.fn(() => Promise.resolve());
  const context: AuthContextValue = {
    session,
    loading: false,
    signIn: () => Promise.resolve(null),
    signUp: () => Promise.resolve(null),
    signOut,
    ...options.value,
  };

  render(
    <MemoryRouter initialEntries={[options.path ?? "/"]}>
      <AuthContext value={context}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<p>capture screen</p>} />
            <Route path="elsewhere" element={<p>another screen</p>} />
          </Route>
        </Routes>
      </AuthContext>
    </MemoryRouter>,
  );

  return { signOut };
}

describe("AppLayout", () => {
  it("offers no navigation to a signed-out visitor", () => {
    renderLayout({ value: { session: null } });

    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "User menu" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("renders both a bottom tab bar and a desktop sidebar, and no hidden-menu trigger", () => {
    renderLayout();

    // jsdom does not evaluate Tailwind's responsive classes, so both landmarks are present here;
    // in a browser exactly one is displayed at any width.
    expect(screen.getAllByRole("navigation", { name: "Main navigation" })).toHaveLength(2);
    // The hamburger drawer this replaced must not come back: hidden navigation measurably hurts
    // discoverability, and every destination now stays visible.
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // The `end` prop regression test: without it the index route matches every path, so the capture
  // destination would read as active on every other route too.
  it("marks exactly the current destination in every navigation, on the capture route", () => {
    renderLayout({ path: "/" });

    for (const nav of screen.getAllByRole("navigation")) {
      const current = within(nav).getAllByRole("link", { current: "page" });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent("Scan");
    }
  });

  it("marks no destination as current on a route that is not the index", () => {
    renderLayout({ path: "/elsewhere" });

    for (const nav of screen.getAllByRole("navigation")) {
      expect(within(nav).queryAllByRole("link", { current: "page" })).toHaveLength(0);
    }
  });

  it("navigates from the bottom tab bar", async () => {
    const user = userEvent.setup();
    renderLayout({ path: "/elsewhere" });

    const [sidebar, bottomBar] = screen.getAllByRole("navigation");
    expect(sidebar).toBeDefined();
    await user.click(within(bottomBar!).getByRole("link", { name: "Scan" }));

    expect(screen.getByText("capture screen")).toBeInTheDocument();
  });

  it("discloses the signed-in account and signs out", async () => {
    const user = userEvent.setup();
    const { signOut } = renderLayout();

    const trigger = screen.getByRole("button", { name: "User menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("FK");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("frane.kuzmanic@gmail.com")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("closes the account panel on Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    renderLayout();

    const trigger = screen.getByRole("button", { name: "User menu" });
    await user.click(trigger);
    expect(screen.getByText("Signed in as")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Signed in as")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes the account panel when a pointer lands outside it", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("Signed in as")).toBeInTheDocument();

    await user.click(screen.getByText("capture screen"));

    expect(screen.queryByText("Signed in as")).not.toBeInTheDocument();
  });
});
