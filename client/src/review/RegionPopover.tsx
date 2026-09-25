import { Pencil, PenLine, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SECTION_COLOURS, SECTION_LABEL_KEYS, fieldLabel } from "./regionSections";

interface RegionPopoverProps {
  field: string;
  value: string | null;
  lowConfidence: boolean;
  /** The printed value was not found among the page's OCR words (ROADMAP locked decision 16). */
  ungroundable: boolean;
  /** Text was printed here but could not be normalised into a value (PRD §6.4). */
  unreadable: boolean;
  /** True once the confirmed value differs from what OCR originally read for this field. */
  edited: boolean;
  /** Distance in pixels from the top of the source image, so the card sits near its outline. */
  top: number;
  /** Absent until there is an input to focus (Task 08 D2), and then no Edit button is shown. */
  onEdit?: () => void;
  onClose: () => void;
}

/**
 * The mobile answer to "what did the app read here?".
 *
 * Tapping an outline used to focus the matching input, which opened the software keyboard and left
 * no room for the source at all. This card deliberately takes **no** focus: the user reads the
 * label and value first, and the keyboard only appears if they choose Edit.
 */
export function RegionPopover({
  field,
  value,
  lowConfidence,
  ungroundable,
  unreadable,
  edited,
  top,
  onEdit,
  onClose,
}: RegionPopoverProps) {
  const { t } = useTranslation();
  const label = fieldLabel(field);
  const title =
    label === null
      ? t("review.sourceTitle")
      : label.row === null
        ? t(label.key)
        : t("review.cellLabel", {
            column: t(label.key),
            section: t(SECTION_LABEL_KEYS[label.section]),
            row: label.row,
          });

  return (
    <div
      role="dialog"
      aria-label={title}
      // Positioned within the panel rather than inside the image's own overflow-hidden viewport,
      // which would clip it. Full panel width avoids any horizontal placement maths on a phone.
      className="absolute inset-x-2 z-10 rounded-lg border border-slate-300 bg-white p-3 shadow-lg"
      style={{ top }}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: label === null ? "#64748b" : SECTION_COLOURS[label.section] }}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-600">
            {title}
            {edited ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
                <PenLine aria-hidden="true" className="size-3" />
                {t("review.inspectEdited")}
              </span>
            ) : null}
          </p>
          <p className="break-words font-semibold">
            {value === null || value.trim() === "" ? (
              <span className="font-normal text-slate-500">{t("review.inspectEmpty")}</span>
            ) : (
              value
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("review.inspectClose")}
          className="-m-1 inline-flex size-12 shrink-0 items-center justify-center text-slate-500"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {lowConfidence ? <Note text={t("review.lowConfidence")} /> : null}
      {ungroundable ? <Note text={t("review.ungroundable")} /> : null}
      {unreadable ? <Note text={t("review.inspectUnreadable")} /> : null}
      {onEdit === undefined ? null : (
        <button
          type="button"
          onClick={onEdit}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover"
        >
          <Pencil aria-hidden="true" className="size-4" />
          {t("review.inspectEdit")}
        </button>
      )}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-1 text-sm text-amber-900">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
