import { ChevronDown, EllipsisVertical, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
}

interface ActionMenuProps {
  /** Unique per rendered menu — it is the `aria-controls` target. */
  id: string;
  /** Names the trigger, and titles the sheet on a narrow screen. */
  label: string;
  items: ActionMenuItem[];
  /** Swaps the trigger glyph for a spinner while an action this menu started is running. */
  busy?: boolean;
  variant?: "icon" | "labelled";
  /** Leading glyph for the labelled variant. The icon variant is always the overflow ellipsis. */
  icon?: LucideIcon;
}

/**
 * One overflow menu, two presentations, decided purely by CSS so there is no second code path.
 *
 * - **Desktop (`lg`+):** a dropdown anchored under the trigger. IBM Carbon puts row actions behind
 *   an overflow menu once there are three or more of them, which is exactly this case.
 * - **Mobile:** a modal bottom sheet with a scrim. Material 3 names the bottom sheet as the mobile
 *   substitute for an inline menu, and `position: fixed` means the sheet can never be clipped by
 *   the card it belongs to.
 *
 * Like `AccountMenu`, this is a **disclosure, not an ARIA menu**: `role="menu"` would oblige a
 * roving-tabindex arrow-key implementation, and plain buttons in a labelled panel are already
 * operable by Tab and announced correctly. Nielsen Norman Group's caution about hidden controls
 * being clicked far less than visible ones is respected by keeping only secondary actions here —
 * opening a payslip stays a plain visible link.
 */
export function ActionMenu({
  id,
  label,
  items,
  busy = false,
  variant = "icon",
  icon: Icon = EllipsisVertical,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;

    // Focus lands on the first action, which is what makes the sheet usable from a keyboard and
    // what a menu button is expected to do.
    panelRef.current?.querySelector("button")?.focus();

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

  function select(item: ActionMenuItem) {
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="true"
        {...(variant === "icon" ? { "aria-label": label } : {})}
        className={
          variant === "icon"
            ? "grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            : "inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        }
      >
        {/* The glyph and the spinner share one 16px box, so a busy trigger neither reflows nor
            leaves a hole — the same convention the export buttons already use. */}
        {busy ? (
          <Spinner label={false} />
        ) : (
          <Icon aria-hidden="true" className={variant === "icon" ? "size-5" : "size-4"} />
        )}
        {variant === "labelled" ? (
          <>
            {label}
            <ChevronDown aria-hidden="true" className="size-4" />
          </>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Mobile scrim. It carries its own pointerdown because it sits inside the container,
              so the outside-click listener above would not treat it as outside. */}
          <div
            aria-hidden="true"
            onPointerDown={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          />
          <div
            ref={panelRef}
            id={id}
            aria-label={label}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-slate-200 bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-lg lg:absolute lg:inset-x-auto lg:right-0 lg:bottom-auto lg:mt-2 lg:w-60 lg:rounded-xl lg:border lg:pb-2"
          >
            <p className="px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase lg:hidden">
              {label}
            </p>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => select(item)}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium ${
                  item.destructive
                    ? "text-red-700 hover:bg-red-50"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
