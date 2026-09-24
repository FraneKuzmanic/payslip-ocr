import { useEffect, useState } from "react";

/**
 * `lg`, the same 1024px line the shell already uses to swap the bottom tab bar for the sidebar.
 * The app therefore has one definition of "desktop" rather than two.
 */
const WIDE = "(min-width: 1024px)";

function wide(): boolean {
  // No matchMedia (jsdom, very old browsers): fall back to the card list, which is the layout
  // that works at any width. A table rendered blind into a narrow viewport would not.
  return window.matchMedia?.(WIDE).matches ?? false;
}

/**
 * The payslip list renders as either a card list or a table, never both. Rendering both and
 * hiding one with CSS would put two copies of every row in the accessibility tree and duplicate
 * every row's action menu, so the choice is made once, here.
 */
export function useWideLayout(): boolean {
  const [isWide, setIsWide] = useState(wide);

  useEffect(() => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return;

    const update = () => setIsWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isWide;
}
