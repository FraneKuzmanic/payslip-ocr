import type { SourceRegion } from "@payslip/shared";
import { useWideLayout } from "../history/useWideLayout";
import { SECTION_COLOURS, sectionOf } from "./regionSections";

interface SourceOverlayProps {
  regions: readonly SourceRegion[];
  page: number;
  activeField: string | null;
  editedFields: readonly string[];
  onSelect: (field: string) => void;
  /** The page's on-screen CSS size. When given, outlines are padded outward by
   * `OUTLINE_GAP_PX` so the stroke sits beside the glyphs rather than on them (Task 15 D13). */
  rendered?: { width: number; height: number };
}

type Corner = SourceRegion["corners"][number];

const NEUTRAL_COLOUR = "#64748b";
/** Matches the box's own corner radius on the 2 px active stroke at `lg`, so a dashed active
 * outline still reads as one continuous line rather than a string of disconnected ticks. */
const EDITED_DASH = "5,3";

/**
 * The gap between the service's quad, which hugs the glyphs, and the drawn outline, in screen
 * pixels (Task 15 D13). At a phone's fit width an A4 text line is only 5–6 CSS px tall.
 */
export const OUTLINE_GAP_PX = 1.5;

/**
 * Stroke widths in CSS px, at rest and active (Task 16 D7). Below `lg` a phone draws 1 CSS px as
 * ~3 device px, around dense table rows only 3.5–4.3 CSS px tall at fit width (history/15 review
 * finding 6), so the phone gets half. The product owner judges them on the phone.
 */
export const STROKE_PX = { wide: { rest: 1, active: 2 }, narrow: { rest: 0.5, active: 1 } };

/**
 * Moves each corner away from the quad's centroid by `padX` / `padY` on each axis. Text quads are
 * near axis-aligned; a rotated one still grows. A corner level with the centroid on an axis does not
 * move on it.
 */
export function padCorners(corners: readonly Corner[], padX: number, padY: number): Corner[] {
  const cx = corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length;
  const cy = corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length;
  return corners.map(({ x, y }) => ({
    x: x + Math.sign(x - cx) * padX,
    y: y + Math.sign(y - cy) * padY,
  }));
}

export function SourceOverlay({
  regions,
  page,
  activeField,
  editedFields,
  onSelect,
  rendered,
}: SourceOverlayProps) {
  const stroke = useWideLayout() ? STROKE_PX.wide : STROKE_PX.narrow;
  const padded = rendered !== undefined && rendered.width > 0 && rendered.height > 0;
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
          const corners = padded
            ? padCorners(
                region.corners,
                OUTLINE_GAP_PX / rendered.width,
                OUTLINE_GAP_PX / rendered.height,
              )
            : region.corners;
          return (
            <polygon
              key={`${region.page}-${region.fields.join("-")}-${index}`}
              points={corners.map(({ x, y }) => `${x},${y}`).join(" ")}
              fill={colour}
              fillOpacity={active ? 0.1 : 0}
              stroke={colour}
              strokeWidth={active ? stroke.active : stroke.rest}
              strokeOpacity={1}
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
