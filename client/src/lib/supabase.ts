import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  // Addressed to whoever is running the app, not to a user: without these the app cannot boot
  // at all, so there is no screen on which to show a translated message. This is the one place
  // an untranslated string is correct.
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env at the repository root.",
  );
}

/**
 * Exactly one instance for the whole app. A second would mean two localStorage listeners and two
 * refresh timers racing each other.
 *
 * `detectSessionInUrl` is false because no email-link flow ships in this task; revisit it when
 * password reset arrives.
 */
export const supabase = createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
