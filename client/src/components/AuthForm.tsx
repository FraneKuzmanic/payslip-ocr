import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AuthActionResult } from "../auth/AuthContext";
import type { AuthErrorKey } from "../auth/authErrors";
import { ErrorMessage } from "./ErrorMessage";

interface AuthFormProps {
  /** Translation key for the heading and the submit button — the same word serves both. */
  titleKey: "auth.signIn" | "auth.signUp";
  /** `current-password` on sign-in, `new-password` on registration. */
  passwordAutoComplete: "current-password" | "new-password";
  alternateLinkKey: "auth.noAccount" | "auth.haveAccount";
  alternateTo: string;
  submit: (email: string, password: string) => Promise<AuthActionResult | null>;
  onSuccess: () => void;
}

/**
 * Shared by the two auth screens, which differ only in copy, autocomplete and where they go
 * next. React Hook Form is deliberately not used: two fields do not need it, and it is not
 * installed until the review form in Task 09.
 */
export function AuthForm({
  titleKey,
  passwordAutoComplete,
  alternateLinkKey,
  alternateTo,
  submit,
  onSuccess,
}: AuthFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);

    const result = await submit(email, password);

    if (result === null) {
      onSuccess();
      return;
    }

    setErrorKey(result.errorKey);
    setSubmitting(false);
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">{t("auth.email")}</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">{t("auth.password")}</span>
          <input
            type="password"
            name="password"
            required
            autoComplete={passwordAutoComplete}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base"
          />
        </label>

        {errorKey === null ? null : <ErrorMessage message={t(errorKey)} />}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:bg-slate-400"
        >
          {submitting ? t("auth.submitting") : t(titleKey)}
        </button>
      </form>

      <Link to={alternateTo} className="min-h-11 content-center text-sm text-slate-600 underline">
        {t(alternateLinkKey)}
      </Link>
    </section>
  );
}
