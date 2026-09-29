import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
            <Route path="payslips" element={<p>payslips screen</p>} />
          </Route>
        </Routes>
      </AuthContext>
    </MemoryRouter>,
  );

  return { signOut };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The desktop sidebar; the bottom bar is the second navigation landmark. */
const desktopNav = () => screen.getAllByRole("navigation", { name: "Main navigation" })[0]!;

describe("AppLayout", () => {
  it("offers no navigation to a signed-out visitor", () => {
    renderLayout({ value: { session: null } });

    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "User menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse menu" })).not.toBeInTheDocument();
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

  it("marks Payslips as the current destination on the list route (Task 14 D2)", () => {
    renderLayout({ path: "/payslips" });

    for (const nav of screen.getAllByRole("navigation")) {
      expect(
        within(nav)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Scan", "Payslips"]);
      const current = within(nav).getAllByRole("link", { current: "page" });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent("Payslips");
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

  describe("collapsible sidebar (Task 15 D6)", () => {
    it("collapses to icons and keeps every link reachable by name", async () => {
      const user = userEvent.setup();
      renderLayout();

      // Task 15b D2: the trigger is in the header, before the app name, not in the nav list.
      const toggle = screen.getByRole("button", { name: "Collapse menu" });
      expect(within(desktopNav()).queryByRole("button")).not.toBeInTheDocument();
      expect(
        toggle.compareDocumentPosition(screen.getByRole("link", { name: "Payslip Scanner" })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", "sidebar-nav-list");
      await user.click(toggle);

      const expand = screen.getByRole("button", { name: "Expand menu" });
      expect(expand).toHaveAttribute("aria-expanded", "false");
      for (const name of ["Scan", "Payslips"]) {
        expect(within(desktopNav()).getByRole("link", { name })).toHaveAttribute("title", name);
      }
      expect(localStorage.getItem("payslip-ocr:sidebar-collapsed")).toBe("1");
    });

    it("gives the toggle a tooltip equal to its name in both states (Task 15b D2)", async () => {
      const user = userEvent.setup();
      renderLayout();

      const toggle = screen.getByRole("button", { name: "Collapse menu" });
      expect(toggle).toHaveAttribute("title", "Collapse menu");
      await user.click(toggle);

      expect(screen.getByRole("button", { name: "Expand menu" })).toHaveAttribute(
        "title",
        "Expand menu",
      );
    });

    it("stays collapsed across a remount", () => {
      localStorage.setItem("payslip-ocr:sidebar-collapsed", "1");
      renderLayout();

      expect(screen.getByRole("button", { name: "Expand menu" })).toBeInTheDocument();
    });

    it("renders expanded and still toggles when storage throws", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const user = userEvent.setup();
      renderLayout();

      await user.click(screen.getByRole("button", { name: "Collapse menu" }));

      expect(screen.getByRole("button", { name: "Expand menu" })).toBeInTheDocument();
    });
  });
});
