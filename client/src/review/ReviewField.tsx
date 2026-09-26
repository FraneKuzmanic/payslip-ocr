import type { TFunction } from "i18next";
import { TriangleAlert } from "lucide-react";
import { cloneElement, type InputHTMLAttributes, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { Attention } from "./fieldAttention";
import type { ReviewErrorKey } from "./reviewForm";

/**
 * Every input's stable id, dense table cells included (ROADMAP Task 09): `review-field-netoPlaca`,
 * `review-field-obustave-2-iznos`. Region → field linking finds inputs by it.
 */
export function fieldId(path: string): string {
  return `review-field-${path.replaceAll(".", "-")}`;
}

/** The inverse of `fieldId`, or null for an element that is not a review input. */
export function pathOfFieldId(id: string): string | null {
  return id.startsWith("review-field-")
    ? id.slice("review-field-".length).replaceAll("-", ".")
    : null;
}

/** The one note an attention signal shows (D18): all of a path's warnings, or its one signal. */
export function attentionMessage(attention: NonNullable<Attention>, t: TFunction): string {
  switch (attention.kind) {
    case "warning":
      return attention.codes.map((code) => t(`warnings.${code}`)).join(" ");
    case "ungroundable":
      return t("review.ungroundable");
    case "lowConfidence":
      return t("review.lowConfidence");
  }
}

/**
 * Amber means "check this", for any attention signal; red means "this will not save". Attention
 * never sets `aria-invalid` (PRD §7.7): an uncertain extraction is not a validation failure. A
 * format error is one (WCAG 3.3.1), so it does.
 */
export function inputClass(attention: boolean, error: boolean): string {
  const tone = error
    ? "border-red-700 bg-white"
    : attention
      ? "border-amber-500 bg-amber-50"
      : "border-slate-300 bg-white";
  return `min-h-12 w-full min-w-0 rounded-lg border px-3 ${tone}`;
}

interface ReviewFieldProps {
  path: string;
  label: string;
  input: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  attention: Attention;
  error?: ReviewErrorKey;
}

/** One labelled scalar input with its attention note and format error (Task 09 D18). */
export function ReviewField({ path, label, input, attention, error }: ReviewFieldProps) {
  const { t } = useTranslation();
  const id = fieldId(path);
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const describedBy = [attention ? noteId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {cloneElement(input, {
        id,
        className: inputClass(attention !== null, error !== undefined),
        ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
        ...(error === undefined ? {} : { "aria-invalid": true }),
      })}
      {attention ? (
        <span id={noteId} className="flex items-start gap-1 text-sm text-amber-900">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{attentionMessage(attention, t)}</span>
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-sm text-red-700">
          {t(error)}
        </span>
      ) : null}
    </label>
  );
}
