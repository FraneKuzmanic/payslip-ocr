import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthContext, type AuthContextValue } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

function renderAt(value: Partial<AuthContextValue>) {
  const context: AuthContextValue = {
    session: null,
    loading: false,
    signIn: () => Promise.resolve(null),
    signUp: () => Promise.resolve(null),
    signOut: () => Promise.resolve(),
    ...value,
  };

  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthContext value={context}>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route element={<ProtectedRoute />}>
            <Route index element={<p>protected content</p>} />
          </Route>
        </Routes>
      </AuthContext>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("shows a loading indicator while the session is being restored", () => {
    renderAt({ loading: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
    // Neither outcome may be shown yet — redirecting here would bounce a signed-in user
    // to the login screen on every page reload.
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("login screen")).not.toBeInTheDocument();
  });

  it("redirects to the login screen when there is no session", () => {
    renderAt({ loading: false, session: null });

    expect(screen.getByText("login screen")).toBeInTheDocument();
  });

  it("renders the protected content when a session exists", () => {
    renderAt({ loading: false, session: { access_token: "token" } as Session });

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
