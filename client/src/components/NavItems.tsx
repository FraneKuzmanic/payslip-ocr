import { Camera, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

/**
 * The destinations, defined once and rendered by both the desktop sidebar and the mobile drawer.
 * Keeping them in one place is what stops the two navigations drifting apart.
 */
export const NAV_ITEMS = [
  { to: "/", labelKey: "common.navCapture", Icon: Camera },
  { to: "/payslips", labelKey: "common.navHistory", Icon: FileText },
] as const;

interface NavItemsProps {
  onNavigate?: () => void;
  /** Icons only, for the collapsed desktop sidebar (Task 15 D6): the name stays for assistive
   * technology and shows as a tooltip. The label fades rather than unmounting, and the padding
   * never changes, so the icon stays put while the sidebar animates (Task 15b D2). */
  collapsed?: boolean;
}

export function NavItems({ onNavigate, collapsed = false }: NavItemsProps) {
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
            title={collapsed ? t(labelKey) : undefined}
            className={({ isActive }) =>
              `flex min-h-12 items-center gap-3 overflow-hidden rounded-lg px-4 text-sm whitespace-nowrap ${
                isActive
                  ? "bg-accent-soft font-semibold text-accent"
                  : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span
              className={`truncate transition-opacity duration-200 ease-linear motion-reduce:transition-none ${
                collapsed ? "opacity-0" : "opacity-100"
              }`}
            >
              {t(labelKey)}
            </span>
          </NavLink>
        </li>
      ))}
    </>
  );
}
