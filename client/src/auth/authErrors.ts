/**
 * Supabase reports failures as stable machine codes alongside untranslated English prose.
 * Only the code is ever used: rendering `error.message` would put English in a Croatian UI,
 * which PRD §7.13 forbids. Anything unrecognised falls back to a generic translated message.
 */
const AUTH_ERROR_KEYS = {
  invalid_credentials: "auth.errors.invalidCredentials",
  email_exists: "auth.errors.emailExists",
  user_already_exists: "auth.errors.emailExists",
  weak_password: "auth.errors.weakPassword",
  email_address_invalid: "auth.errors.emailInvalid",
  validation_failed: "auth.errors.validationFailed",
  over_request_rate_limit: "auth.errors.rateLimited",
  over_email_send_rate_limit: "auth.errors.rateLimited",
  signup_disabled: "auth.errors.signupDisabled",
  email_not_confirmed: "auth.errors.emailNotConfirmed",
} as const;

export const GENERIC_AUTH_ERROR_KEY = "auth.errors.generic";

export type AuthErrorKey =
  (typeof AUTH_ERROR_KEYS)[keyof typeof AUTH_ERROR_KEYS] | typeof GENERIC_AUTH_ERROR_KEY;

export function authErrorKey(code: string | undefined): AuthErrorKey {
  if (code === undefined) return GENERIC_AUTH_ERROR_KEY;
  return AUTH_ERROR_KEYS[code as keyof typeof AUTH_ERROR_KEYS] ?? GENERIC_AUTH_ERROR_KEY;
}

/** Exported for the test that proves every mapped key exists in both locale files. */
export const ALL_AUTH_ERROR_KEYS: readonly AuthErrorKey[] = [
  ...new Set<AuthErrorKey>([...Object.values(AUTH_ERROR_KEYS), GENERIC_AUTH_ERROR_KEY]),
];
