import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { AccountMenu } from "./AccountMenu";
import { BottomNav } from "./BottomNav";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NavItems } from "./NavItems";
import { ToastProvider } from "./Toast";

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();

  // Carried over from Task 02: index.html hardcoded lang="hr" and a Croatian title, so a fresh
  // load in English still advertised Croatian to the browser and to assistive technology.
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "hr";
    document.title = t("common.appName");
  }, [i18n.resolvedLanguage, t]);

  // The login and register routes render inside this layout but outside ProtectedRoute, so this
  // component genuinely renders with a null session and must offer no navigation to a visitor.
  const signedIn = session !== null;

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 lg:h-16 lg:gap-2 lg:px-4">
          <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg">
            {/* One line at every width: the name wraps to two rows on a 375px screen otherwise,
                which makes the single-row header taller than the 56px it is specified at. */}
            <span className="truncate text-sm font-semibold whitespace-nowrap lg:text-base">
              {t("common.appName")}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <LanguageSwitcher />
            {signedIn ? <AccountMenu /> : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {signedIn ? (
            <nav
              aria-label={t("common.mainNav")}
              className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-3 lg:block"
            >
              <ul className="flex flex-col gap-1">
                <NavItems />
              </ul>
            </nav>
          ) : null}
          {/* pb clears the fixed bottom bar so the last row of a list is never trapped behind it. */}
          <main className={`min-w-0 flex-1 ${signedIn ? "pb-16 lg:pb-0" : ""}`}>
            <Outlet />
          </main>
        </div>

        {signedIn ? <BottomNav /> : null}
      </div>
    </ToastProvider>
  );
}
