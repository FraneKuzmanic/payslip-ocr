import { createContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { AuthErrorKey } from "./authErrors";

/** Actions resolve to a translation key instead of throwing, so forms can render copy directly. */
export interface AuthActionResult {
  errorKey: AuthErrorKey;
}

export interface AuthContextValue {
  readonly session: Session | null;
  /** True until the first getSession() resolves. Never render a redirect while it is true. */
  readonly loading: boolean;
  signIn(email: string, password: string): Promise<AuthActionResult | null>;
  signUp(email: string, password: string): Promise<AuthActionResult | null>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
