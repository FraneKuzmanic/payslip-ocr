import { useEffect, useState } from "react";
import { isObscured } from "./stripGeometry";

const COARSE = "(pointer: coarse)";

/** Focus predicts the keyboard before its animation; Android's back gesture may retain focus. */
export function useSoftKeyboard(focusedPath: string | null): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia?.(COARSE).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(COARSE);
    if (!media) return;
    const update = () => setCoarse(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const open = coarse && focusedPath !== null;
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset["keyboard"] = "open";
    const viewport = window.visualViewport;
    let checked = false;
    const position = () => root.style.setProperty("--visual-top", `${viewport?.offsetTop ?? 0}px`);
    const resize = () => {
      position();
      if (checked || !viewport) return;
      checked = true;
      const input = document.activeElement;
      // getBoundingClientRect uses layout-viewport coordinates; include iOS's visual offset.
      if (
        input instanceof HTMLElement &&
        isObscured(
          input.getBoundingClientRect(),
          viewport.offsetTop + 64,
          viewport.offsetTop + viewport.height,
        )
      ) {
        input.scrollIntoView?.({ block: "center" });
      }
    };
    position();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", position);
    return () => {
      delete root.dataset["keyboard"];
      root.style.removeProperty("--visual-top");
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", position);
    };
  }, [open]);
  return open;
}
