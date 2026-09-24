import type { SourceRegion } from "@payslip/shared";
import { SECTION_COLOURS, sectionOf } from "./regionSections";

interface SourceOverlayProps {
  regions: readonly SourceRegion[];
  page: number;
  activeField: string | null;
  editedFields: readonly string[];
  onSelect: (field: string) => void;
}

const NEUTRAL_COLOUR = "#64748b";
/** Matches the box's own corner radius on `strokeWidth={2.5}`, so a dashed active outline still
 * reads as one continuous line rather than a string of disconnected ticks. */
const EDITED_DASH = "5,3";

export function SourceOverlay({
  regions,
  page,
  activeField,
  editedFields,
  onSelect,
}: SourceOverlayProps) {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      {regions
        .filter((region) => region.page === page)
        .map((region, index) => {
          const active = activeField !== null && region.fields.includes(activeField);
          const edited = region.fields.some((field) => editedFields.includes(field));
          const section = sectionOf(region.fields[0] ?? "");
          const colour = section === null ? NEUTRAL_COLOUR : SECTION_COLOURS[section];
          return (
            <polygon
              key={`${region.page}-${region.fields.join("-")}-${index}`}
              points={region.corners.map(({ x, y }) => `${x},${y}`).join(" ")}
              fill={colour}
              fillOpacity={active ? 0.15 : 0}
              stroke={colour}
              strokeWidth={active ? 2.5 : 1.25}
              strokeOpacity={active ? 1 : 0.55}
              strokeDasharray={edited ? EDITED_DASH : undefined}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              style={{ pointerEvents: "all" }}
              onClick={() => onSelect(region.fields[0]!)}
            />
          );
        })}
    </svg>
  );
}
