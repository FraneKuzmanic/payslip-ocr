import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AuthContext, type AuthActionResult, type AuthContextValue } from "./AuthContext";
import { authErrorKey } from "./authErrors";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      // Only after the first read: clearing it earlier makes an authenticated user see the
      // login screen flash on every reload.
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Never await another Supabase call in here — it deadlocks the auth client. Set and return.
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthActionResult | null> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? { errorKey: authErrorKey(error.code) } : null;
    },
    [],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthActionResult | null> => {
      const { error } = await supabase.auth.signUp({ email, password });
      return error ? { errorKey: authErrorKey(error.code) } : null;
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, signIn, signUp, signOut }),
    [session, loading, signIn, signUp, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
