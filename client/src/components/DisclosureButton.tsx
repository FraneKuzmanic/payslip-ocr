import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface DisclosureButtonProps {
  expanded: boolean;
  /** The id of the region this button shows and hides. */
  controls: string;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * The one disclosure pattern (Task 15 D10, WAI-ARIA APG Disclosure): a borderless button whose
 * chevron points right while closed. Used instead of a native `<details>` because the controlled
 * region must stay mounted while hidden, and some callers open it programmatically.
 */
export function DisclosureButton({
  expanded,
  controls,
  onToggle,
  children,
  className = "",
}: DisclosureButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={`inline-flex min-h-12 items-center gap-2 text-left font-semibold text-slate-700 hover:text-slate-900 ${className}`}
    >
      <ChevronDown
        aria-hidden="true"
        className={`size-5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
      />
      {children}
    </button>
  );
}
