import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { ConfirmPayslipResponse, PayslipDetailResponse } from "@payslip/shared";
import { ApiError, confirmPayslip, updatePayslip } from "../api/client";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { attentionFor, type AttentionSignals } from "./fieldAttention";
import { LineItemSection } from "./LineItemSection";
import { ReviewField, pathOfFieldId } from "./ReviewField";
import {
  SCALAR_LABEL_KEYS,
  SCALAR_SECTIONS,
  SECTION_LABEL_KEYS,
  type ScalarField,
  type Section,
} from "./regionSections";
import {
  SCALAR_KINDS,
  TABLE_FIELDS,
  toFormValues,
  toPatch,
  validatorFor,
  type FormLanguage,
  type ReviewErrorKey,
  type ReviewFormValues,
} from "./reviewForm";
import { SectionLegend } from "./SectionLegend";

const SCALAR_SECTION_ORDER = ["employer", "employee", "period", "reconciliation"] as const;

const FIELDS_BY_SECTION = Object.fromEntries(
  SCALAR_SECTION_ORDER.map((section) => [
    section,
    (Object.entries(SCALAR_SECTIONS) as [ScalarField, Section][])
      .filter(([, of]) => of === section)
      .map(([field]) => field),
  ]),
) as Record<(typeof SCALAR_SECTION_ORDER)[number], ScalarField[]>;

/** An API refusal with its own copy; anything else gets the action's generic message. */
const ERROR_COPY = {
  tables_pending: "review.errors.tablesPending",
  edit_not_allowed: "review.errors.editNotAllowed",
  confirm_not_allowed: "review.errors.confirmNotAllowed",
} as const;

function errorKey(error: unknown, fallback: "review.errors.save" | "review.errors.confirm") {
  const code = error instanceof ApiError ? error.code : undefined;
  return code !== undefined && Object.hasOwn(ERROR_COPY, code)
    ? ERROR_COPY[code as keyof typeof ERROR_COPY]
    : fallback;
}

interface PayslipFormProps {
  detail: PayslipDetailResponse;
  onSaved: (next: PayslipDetailResponse) => void;
  onConfirmed: (next: ConfirmPayslipResponse) => void;
  onDirtyChange: (dirty: boolean) => void;
  /** The focused input's canonical path, or null once focus leaves the form (D9). */
  onFieldFocus: (path: string | null) => void;
}

/**
 * The review form (Task 09): every canonical field editable, grouped in the PRD §7.7 sections.
 * Saving is explicit, never debounced; confirming is refused while the form is dirty or the tables
 * pass is pending, and is idempotent after. A missing critical field or a warning never blocks
 * either.
 */
export function PayslipForm({
  detail,
  onSaved,
  onConfirmed,
  onDirtyChange,
  onFieldFocus,
}: PayslipFormProps) {
  const { t, i18n } = useTranslation();
  const { show } = useToast();
  const language: FormLanguage = i18n.language.startsWith("hr") ? "hr" : "en";
  const values = useMemo(() => toFormValues(detail, language), [detail, language]);
  // `values` re-formats untouched fields on a language switch and fills the tables when they land;
  // `keepDirtyValues` keeps whatever the user is typing through both (D12, D19).
  const { register, control, handleSubmit, reset, formState } = useForm<ReviewFormValues>({
    values,
    resetOptions: { keepDirtyValues: true },
  });
  const { isDirty, dirtyFields, errors } = formState;
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // A review closed without switching (browser Back) must not leave the page dirty (D13).
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const signals: AttentionSignals = {
    warnings: detail.warnings,
    lowConfidenceFields: detail.lowConfidenceFields,
    ungroundableFields: detail.ungroundableFields,
  };
  const pending = detail.tablesStatus === "pending";
  const confirmed = detail.status === "confirmed";
  const confirmBlocked = isDirty
    ? "review.confirmBlockedDirty"
    : pending
      ? "review.confirmBlockedPending"
      : null;

  async function save(next: ReviewFormValues) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updatePayslip(detail.id, toPatch(next, dirtyFields, !pending));
      reset(toFormValues(saved, language));
      onSaved(saved);
      show(t("review.saved"));
    } catch (caught) {
      console.error("[review] saving failed", caught);
      setError(t(errorKey(caught, "review.errors.save")));
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    if (confirming || confirmBlocked !== null) return;
    setConfirming(true);
    setError(null);
    try {
      onConfirmed(await confirmPayslip(detail.id));
      show(t("review.confirmed"));
    } catch (caught) {
      console.error("[review] confirming failed", caught);
      setError(t(errorKey(caught, "review.errors.confirm")));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(save, () => setError(t("review.invalidForm")))}
      onFocusCapture={(event) => onFieldFocus(pathOfFieldId((event.target as HTMLElement).id))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFieldFocus(null);
      }}
      className="flex min-w-0 flex-col gap-6"
    >
      {SCALAR_SECTION_ORDER.map((section) => (
        <fieldset key={section} className="flex flex-col gap-3">
          <SectionLegend section={section} label={t(SECTION_LABEL_KEYS[section])} />
          {FIELDS_BY_SECTION[section].map((field) => {
            const kind = SCALAR_KINDS[field];
            return (
              <ReviewField
                key={field}
                path={field}
                label={t(SCALAR_LABEL_KEYS[field])}
                attention={attentionFor(field, signals)}
                error={errors[field]?.message as ReviewErrorKey | undefined}
                input={
                  <input
                    type="text"
                    autoComplete="off"
                    inputMode={kind === "amount" || kind === "quantity" ? "decimal" : undefined}
                    {...register(field, { validate: validatorFor(kind) })}
                  />
                }
              />
            );
          })}
        </fieldset>
      ))}

      {TABLE_FIELDS.map((table) => (
        <LineItemSection
          key={table}
          table={table}
          control={control}
          register={register}
          tablesStatus={detail.tablesStatus}
          signals={signals}
          errors={errors}
        />
      ))}

      {/* Pinned above the phone's bottom navigation, whose height the toast offset also uses (D14). */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 lg:bottom-0 lg:mx-0 lg:px-0">
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <p role="status" className="text-sm text-amber-900 empty:hidden">
          {isDirty ? t("review.unsaved") : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            aria-disabled={saving}
            className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400"
          >
            {saving ? <Spinner label={false} className="size-5" /> : null}
            {saving ? t("review.saving") : t("review.save")}
          </button>
          {confirmed ? (
            <p className="inline-flex min-h-12 items-center gap-2 font-semibold text-emerald-800">
              <CheckCircle2 aria-hidden="true" className="size-5" />
              {t("payslipStatus.confirmed")}
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void confirm()}
                aria-disabled={confirming || confirmBlocked !== null}
                aria-describedby={confirmBlocked === null ? undefined : "review-confirm-reason"}
                className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
              >
                {confirming ? <Spinner label={false} className="size-5" /> : null}
                {confirming ? t("review.confirming") : t("review.confirm")}
              </button>
              {confirmBlocked === null ? null : (
                <p id="review-confirm-reason" className="text-sm text-slate-600">
                  {t(confirmBlocked)}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </form>
  );
}
