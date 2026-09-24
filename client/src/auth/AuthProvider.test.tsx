import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AuthChangeEvent, AuthError, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./useAuth";

type GetSessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type SignInResult = Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
type SignOutResult = Awaited<ReturnType<typeof supabase.auth.signOut>>;
type StateChangeHandler = (event: AuthChangeEvent, session: Session | null) => void;

let getSession: MockInstance<typeof supabase.auth.getSession>;
let signInWithPassword: MockInstance<typeof supabase.auth.signInWithPassword>;
let signOut: MockInstance<typeof supabase.auth.signOut>;

/** Captured so a test can play the part of Supabase notifying the app. */
let notify: StateChangeHandler;
const unsubscribe = vi.fn();

const session = { access_token: "fresh-token" } as Session;

function Harness() {
  const { session: current, loading, signIn, signOut: doSignOut } = useAuth();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (loading) return <p>loading</p>;

  return (
    <div>
      <p>{current === null ? "signed out" : `signed in: ${current.access_token}`}</p>
      {errorKey === null ? null : <p>{errorKey}</p>}
      <button
        type="button"
        onClick={() => {
          void signIn("user@example.test", "password").then((result) => {
            setErrorKey(result?.errorKey ?? null);
          });
        }}
      >
        sign in
      </button>
      <button type="button" onClick={() => void doSignOut()}>
        sign out
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
}

beforeEach(() => {
  getSession = vi.spyOn(supabase.auth, "getSession");
  signInWithPassword = vi.spyOn(supabase.auth, "signInWithPassword");
  signOut = vi.spyOn(supabase.auth, "signOut");

  getSession.mockResolvedValue({ data: { session: null }, error: null } as GetSessionResult);
  signOut.mockResolvedValue({ error: null } as SignOutResult);

  unsubscribe.mockClear();
  vi.spyOn(supabase.auth, "onAuthStateChange").mockImplementation((handler) => {
    notify = handler;
    return { data: { subscription: { id: "test", callback: handler, unsubscribe } } };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("stays in a loading state until the first session read resolves", async () => {
    renderProvider();

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("restores an existing session on mount without a signed-out flash", async () => {
    getSession.mockResolvedValue({ data: { session }, error: null } as GetSessionResult);

    renderProvider();

    expect(await screen.findByText("signed in: fresh-token")).toBeInTheDocument();
    expect(screen.queryByText("signed out")).not.toBeInTheDocument();
  });

  it("adopts the session Supabase reports through onAuthStateChange", async () => {
    renderProvider();
    await screen.findByText("signed out");

    act(() => {
      notify("SIGNED_IN", session);
    });

    expect(screen.getByText("signed in: fresh-token")).toBeInTheDocument();
  });

  it("returns a translation key on failure and never Supabase's English prose", async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" } as AuthError,
    } as SignInResult);

    renderProvider();
    await screen.findByText("signed out");

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    expect(await screen.findByText("auth.errors.invalidCredentials")).toBeInTheDocument();
    expect(screen.queryByText("Invalid login credentials")).not.toBeInTheDocument();
  });

  it("clears the session when Supabase reports a sign-out", async () => {
    getSession.mockResolvedValue({ data: { session }, error: null } as GetSessionResult);

    renderProvider();
    await screen.findByText("signed in: fresh-token");

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);

    act(() => {
      notify("SIGNED_OUT", null);
    });

    expect(screen.getByText("signed out")).toBeInTheDocument();
  });

  it("unsubscribes on unmount, which StrictMode's double-invoked effects rely on", async () => {
    const { unmount } = renderProvider();
    await screen.findByText("signed out");

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
