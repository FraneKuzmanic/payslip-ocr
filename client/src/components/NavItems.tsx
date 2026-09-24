import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

/**
 * The destinations, defined once and rendered by both the desktop sidebar and the mobile drawer.
 * Keeping them in one place is what stops the two navigations drifting apart.
 */
export const NAV_ITEMS = [{ to: "/", labelKey: "common.navCapture", Icon: Camera }] as const;

export function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();

  return (
    <>
      {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
        <li key={to}>
          <NavLink
            to={to}
            // Without `end`, the index route matches every path and the capture item reads as
            // active on every other path. NavLink emits aria-current="page" itself — do not add it manually.
            end={to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                isActive
                  ? "bg-accent-soft font-semibold text-accent"
                  : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            {t(labelKey)}
          </NavLink>
        </li>
      ))}
    </>
  );
}
