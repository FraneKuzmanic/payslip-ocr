import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { AccountMenu } from "./AccountMenu";
import { BottomNav } from "./BottomNav";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NavItems } from "./NavItems";
import { ToastProvider } from "./Toast";

const SIDEBAR_KEY = "payslip-ocr:sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  // Task 15 D6: remembered per browser; a blocked storage leaves it expanded and in memory only.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (next) localStorage.setItem(SIDEBAR_KEY, "1");
      else localStorage.removeItem(SIDEBAR_KEY);
    } catch {
      // Storage is unavailable (a private window); the state lasts for this page only.
    }
  }

  // Carried over from Task 02: index.html hardcoded lang="hr" and a Croatian title, so a fresh
  // load in English still advertised Croatian to the browser and to assistive technology.
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "hr";
    document.title = t("common.appName");
  }, [i18n.resolvedLanguage, t]);

  // The login and register routes render inside this layout but outside ProtectedRoute, so this
  // component genuinely renders with a null session and must offer no navigation to a visitor.
  const signedIn = session !== null;
  const toggleLabel = t(collapsed ? "common.expandMenu" : "common.collapseMenu");

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 lg:h-16 lg:gap-2 lg:px-4">
          {signedIn ? (
            // Task 15b D2, after shadcn/ui's Sidebar (`SidebarTrigger` in the page header, then a
            // vertical separator): a quiet icon button, not a nav item. Sized like the header's
            // other controls; its icon sits 38 px from the edge, above the nav icons.
            <>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-expanded={!collapsed}
                aria-controls="sidebar-nav-list"
                aria-label={toggleLabel}
                title={toggleLabel}
                className="hidden min-h-11 min-w-11 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:grid"
              >
                <PanelLeft aria-hidden="true" className="size-5" />
              </button>
              <span aria-hidden="true" className="mr-1 hidden h-5 w-px bg-slate-200 lg:block" />
            </>
          ) : null}
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
            // Sticky below the 4rem header, so the destinations stay in place while the page
            // scrolls (Task 14 D15).
            <nav
              aria-label={t("common.mainNav")}
              // Task 15b D2, as shadcn/ui's Sidebar: only the width changes, over 200 ms, linear.
              // The padding is the same in both states, so the icons never move and the labels
              // are clipped and faded (`NavItems`). Collapsed, 76 px leaves the links 51 px wide.
              className={`hidden ${
                collapsed ? "w-19" : "w-60"
              } shrink-0 overflow-x-hidden border-r border-slate-200 bg-white p-3 transition-[width] duration-200 ease-linear motion-reduce:transition-none lg:sticky lg:top-16 lg:block lg:h-[calc(100dvh-4rem)] lg:self-start lg:overflow-y-auto`}
            >
              <ul id="sidebar-nav-list" className="flex flex-col gap-1">
                <NavItems collapsed={collapsed} />
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
