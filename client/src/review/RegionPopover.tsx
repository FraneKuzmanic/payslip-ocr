import { Pencil, PenLine, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SECTION_COLOURS, fieldLabelKey, sectionOf } from "./regionSections";

interface RegionPopoverProps {
  field: string;
  value: string | null;
  lowConfidence: boolean;
  /** True once the confirmed value differs from what OCR originally read for this field. */
  edited: boolean;
  /** Distance in pixels from the top of the source image, so the card sits near its outline. */
  top: number;
  onEdit: () => void;
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
  edited,
  top,
  onEdit,
  onClose,
}: RegionPopoverProps) {
  const { t } = useTranslation();
  const section = sectionOf(field);
  const labelKey = fieldLabelKey(field);

  return (
    <div
      role="dialog"
      aria-label={labelKey === null ? t("review.sourceTitle") : t(labelKey)}
      // Positioned within the panel rather than inside the image's own overflow-hidden viewport,
      // which would clip it. Full panel width avoids any horizontal placement maths on a phone.
      className="absolute inset-x-2 z-10 rounded-lg border border-slate-300 bg-white p-3 shadow-lg"
      style={{ top }}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: section === null ? "#64748b" : SECTION_COLOURS[section] }}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-600">
            {labelKey === null ? t("review.sourceTitle") : t(labelKey)}
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
          className="-m-1 inline-flex size-11 shrink-0 items-center justify-center text-slate-500"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {lowConfidence ? (
        <p className="mt-2 flex items-start gap-1 text-sm text-amber-900">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t("review.lowConfidence")}</span>
        </p>
      ) : null}
      <button
        type="button"
        onClick={onEdit}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover"
      >
        <Pencil aria-hidden="true" className="size-4" />
        {t("review.inspectEdit")}
      </button>
    </div>
  );
}
