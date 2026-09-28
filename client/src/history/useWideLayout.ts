import { useEffect, useState } from "react";

/**
 * `lg`, where every wide layout starts since Task 14 put the session rail on top at every width.
 */
export const LG = "(min-width: 1024px)";

function wide(query: string): boolean {
  // No matchMedia (jsdom, very old browsers): fall back to the card list, which is the layout
  // that works at any width. A table rendered blind into a narrow viewport would not.
  return window.matchMedia?.(query).matches ?? false;
}

/**
 * The payslip list renders as either a card list or a table, never both. Rendering both and
 * hiding one with CSS would put two copies of every row in the accessibility tree and duplicate
 * every row's action menu, so the choice is made once, here.
 */
export function useWideLayout(query: string = LG): boolean {
  const [isWide, setIsWide] = useState(() => wide(query));

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;

    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return isWide;
}
