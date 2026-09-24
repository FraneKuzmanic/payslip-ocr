import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/useAuth";
import { displayEmail, initialsFromEmail } from "../auth/userIdentity";

/**
 * A disclosure, deliberately not an ARIA menu: the panel holds a static identity block plus one
 * action, so role="menu" would oblige a roving-tabindex arrow-key implementation and would make
 * screen readers announce the email address as a menu item.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const { session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;

    function close(restoreFocus: boolean) {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    function onPointerDown(event: PointerEvent) {
      if (!container?.contains(event.target as Node)) close(false);
    }
    // WCAG 2.1 SC 1.4.13: content must dismiss when focus leaves it.
    function onFocusOut(event: FocusEvent) {
      if (!container?.contains(event.relatedTarget as Node | null)) close(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    container?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      container?.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  const email = session?.user.email;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="account-panel"
        aria-label={t("common.accountMenu")}
        className="grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-slate-100"
      >
        {/* A 36px circle inside a 44px target: padding counts toward the pointer target, so this
            satisfies WCAG 2.5.5 while staying visually compact. */}
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
        >
          {initialsFromEmail(email)}
        </span>
      </button>

      {open ? (
        <div
          id="account-panel"
          className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="text-xs text-slate-500">{t("common.signedInAs")}</p>
            <p className="text-sm font-medium break-all text-slate-900">
              {displayEmail(email, t("common.noEmail"))}
            </p>
          </div>
          <hr className="my-1 border-slate-200" />
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            {t("auth.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
