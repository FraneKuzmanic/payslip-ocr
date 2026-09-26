import { SECTION_COLOURS, type Section } from "./regionSections";

/** A form section's name with the colour dot its outlines use (PRD §7.7, Task 08 D4). */
export function SectionLegend({ section, label }: { section: Section; label: string }) {
  return (
    <legend className="flex items-center gap-2 font-semibold">
      <span
        aria-hidden="true"
        className="size-2.5 rounded-full"
        style={{ backgroundColor: SECTION_COLOURS[section] }}
      />
      {label}
    </legend>
  );
}
