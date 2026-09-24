import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { NAV_ITEMS } from "./NavItems";

/**
 * Mobile primary navigation: a fixed bottom tab bar, the standard pattern for an app with a small
 * number of top-level destinations.
 *
 * It replaced a hamburger drawer. Nielsen Norman Group measured that hiding navigation roughly
 * halves discoverability and cuts task completion by ~21%, and their guidance is to show navigation
 * visibly at four or fewer destinations — this app has two. Tap accuracy is also ~96% in the bottom
 * thumb zone against ~61% at the top of the screen, which is where the drawer's trigger sat.
 *
 * The desktop sidebar takes over at `lg`, where a persistent side rail is the equivalent
 * convention and the bottom bar would waste vertical space on a pointer-driven screen.
 */
export function BottomNav() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("common.mainNav")}
      // pb keeps the labels clear of the iOS home indicator without adding height on Android.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive ? "text-accent" : "text-slate-500 hover:text-slate-900"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* The active pill is the visual anchor: colour alone would not survive a
                      grayscale screenshot or a colour-vision difference. */}
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-12 items-center justify-center rounded-full ${
                      isActive ? "bg-accent-soft" : ""
                    }`}
                  >
                    <Icon className="size-5 shrink-0" />
                  </span>
                  {t(labelKey)}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
