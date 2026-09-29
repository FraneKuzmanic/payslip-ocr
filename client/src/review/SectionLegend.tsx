import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DisclosureButton } from "../components/DisclosureButton";
import { SECTION_COLOURS, type Section } from "./regionSections";

interface SectionLegendProps {
  section: Section;
  label: string;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
  summary?: ReactNode;
}

/**
 * A form section's name with the colour dot its outlines use (PRD §7.7, Task 08 D4), as the
 * section's disclosure (Task 15 D9).
 */
export function SectionLegend({
  section,
  label,
  expanded,
  controls,
  onToggle,
  summary,
}: SectionLegendProps) {
  const dot = (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: SECTION_COLOURS[section] }}
    />
  );
  return (
    <legend className="w-full">
      <DisclosureButton expanded={expanded} controls={controls} onToggle={onToggle}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-2">
            {dot}
            {label}
          </span>
          {summary ? (
            <span className="inline-flex items-center gap-2 text-sm font-normal text-slate-600">
              {summary}
            </span>
          ) : null}
        </span>
      </DisclosureButton>
    </legend>
  );
}

/** The amber "N to check" a section header carries while anything inside needs attention. */
export function ToCheck({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-amber-900">
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      {t("review.toCheck", { count })}
    </span>
  );
}
