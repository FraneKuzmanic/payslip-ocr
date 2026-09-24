import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import hr from "../i18n/locales/hr.json";
import { ALL_AUTH_ERROR_KEYS, GENERIC_AUTH_ERROR_KEY, authErrorKey } from "./authErrors";

function lookup(locale: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[part];
  }, locale);
}

describe("authErrorKey", () => {
  it("maps a known Supabase code to its own message", () => {
    expect(authErrorKey("invalid_credentials")).toBe("auth.errors.invalidCredentials");
  });

  it("maps both duplicate-account codes to one message", () => {
    expect(authErrorKey("email_exists")).toBe(authErrorKey("user_already_exists"));
  });

  it("falls back to the generic message for an unknown or missing code", () => {
    expect(authErrorKey("something_new_supabase_added")).toBe(GENERIC_AUTH_ERROR_KEY);
    expect(authErrorKey(undefined)).toBe(GENERIC_AUTH_ERROR_KEY);
  });
});

// Phase 6.5 of /validate only scans translation calls whose key is a string literal, and these
// keys are computed from an error code, so nothing else would catch a mapped code whose
// translation was never written.
describe("every mapped key has a translation", () => {
  it.each(ALL_AUTH_ERROR_KEYS)("%s exists in both en and hr", (key) => {
    expect(lookup(en, key)).toBeTypeOf("string");
    expect(lookup(hr, key)).toBeTypeOf("string");
    expect(lookup(en, key)).not.toBe("");
    expect(lookup(hr, key)).not.toBe("");
  });
});
