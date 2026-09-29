import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { ConfirmPayslipResponse, PayslipDetailResponse } from "@payslip/shared";
import { ApiError, confirmPayslip, updatePayslip } from "../api/client";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { attentionCount, attentionFor, type AttentionSignals } from "./fieldAttention";
import { LineItemSection } from "./LineItemSection";
import { ReviewField, pathOfFieldId } from "./ReviewField";
import {
  SCALAR_LABEL_KEYS,
  SCALAR_SECTIONS,
  SECTION_LABEL_KEYS,
  sectionOf,
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
import { SectionLegend, ToCheck } from "./SectionLegend";
import type { UnsavedEdits } from "./unsaved/UnsavedEditsContext";

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
  initialEdits?: UnsavedEdits;
  onClose: (edits: UnsavedEdits | null) => void;
  /** The focused input's canonical path, or null once focus leaves the form (D9). */
  onFieldFocus: (path: string | null) => void;
  /** Which sections are open (Task 15 D9); closed ones stay mounted and hidden. */
  open: Readonly<Record<Section, boolean>>;
  onToggleSection: (section: Section) => void;
  /** Opens the sections a failed save has errors in, before the first error is focused. */
  onOpenSections: (sections: Section[]) => void;
}

/** The section of a top-level form key: a table's own name, or a scalar's section. */
function sectionOfKey(key: string): Section | null {
  return (TABLE_FIELDS as readonly string[]).includes(key) ? (key as Section) : sectionOf(key);
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
  initialEdits,
  onClose,
  onFieldFocus,
  open,
  onToggleSection,
  onOpenSections,
}: PayslipFormProps) {
  const { t, i18n } = useTranslation();
  const { show } = useToast();
  const language: FormLanguage = i18n.language.startsWith("hr") ? "hr" : "en";
  const values = useMemo(() => toFormValues(detail, language), [detail, language]);
  // `values` re-formats untouched fields on a language switch and fills the tables when they land;
  // `keepDirtyValues` keeps whatever the user is typing through both (D12, D19).
  const { register, control, handleSubmit, reset, getValues, formState } =
    useForm<ReviewFormValues>({
      values,
      resetOptions: { keepDirtyValues: true },
    });
  const { isDirty, dirtyFields, errors } = formState;
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ isDirty, dirtyFields, onClose, onDirtyChange });
  latest.current = { isDirty, dirtyFields, onClose, onDirtyChange };

  // Restore only the changed top-level keys; fresh tables can have arrived while away (Task 10 D1).
  useEffect(() => {
    if (initialEdits === undefined) return;
    const picked = Object.fromEntries(
      initialEdits.dirtyKeys.map((key) => [key, initialEdits.values[key]]),
    );
    // reset also restores field-array length; setValue alone leaves removed rows mounted.
    reset({ ...getValues(), ...picked }, { keepDefaultValues: true });
  }, []);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Clear the mounted form first, then keep its snapshot: the closed payslip must stay marked
  // unsaved. Callback changes during typing must never run this cleanup (Task 10 D1).
  useEffect(
    () => () => {
      const current = latest.current;
      current.onDirtyChange(false);
      current.onClose(
        current.isDirty
          ? {
              values: getValues(),
              dirtyKeys: (Object.keys(current.dirtyFields) as (keyof ReviewFormValues)[]).filter(
                (key) => hasDirtyLeaf(current.dirtyFields[key]),
              ),
            }
          : null,
      );
    },
    [],
  );

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
      id="review-form"
      noValidate
      // Task 15 D11: "Discard changes" is a reset button outside the form. Resetting to the saved
      // values restores the field arrays' length too. `reset` merges the form's `resetOptions`
      // into every call, so `keepDirtyValues` must be turned off here or the typing would stay.
      onReset={(event) => {
        event.preventDefault();
        reset(values, { keepDirtyValues: false });
        setError(null);
      }}
      // react-hook-form runs this before it focuses the first error, and a hidden input cannot
      // take focus, so the sections holding errors open synchronously first (Task 15 D9).
      onSubmit={handleSubmit(save, (invalid) => {
        const sections = Object.keys(invalid)
          .map(sectionOfKey)
          .filter((section) => section !== null);
        flushSync(() => onOpenSections(sections));
        setError(t("review.invalidForm"));
      })}
      onFocusCapture={(event) => onFieldFocus(pathOfFieldId((event.target as HTMLElement).id))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFieldFocus(null);
      }}
      className="flex min-w-0 flex-col gap-6"
    >
      {SCALAR_SECTION_ORDER.map((section) => (
        <fieldset key={section} className="flex flex-col gap-3">
          <SectionLegend
            section={section}
            label={t(SECTION_LABEL_KEYS[section])}
            expanded={open[section]}
            controls={`review-section-${section}`}
            onToggle={() => onToggleSection(section)}
            summary={<ToCheck count={attentionCount(FIELDS_BY_SECTION[section], signals)} />}
          />
          <div
            id={`review-section-${section}`}
            hidden={!open[section]}
            className="flex flex-col gap-3"
          >
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
          </div>
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
          expanded={open[table]}
          onToggle={() => onToggleSection(table)}
        />
      ))}

      {/* In flow after the last table (Task 14 D13, superseding the Task 09 D14 sticky bar). It is
          not hidden while typing: hiding an in-flow block would shift the form under the finger. */}
      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <p role="status" className="text-sm text-amber-900 empty:hidden">
          {isDirty ? t("review.unsaved") : ""}
        </p>
        {/* Task 15 D12: full width and stacked on a phone, a row at lg. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
          <button
            type="submit"
            aria-disabled={saving}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400 lg:w-auto"
          >
            {saving ? <Spinner label={false} className="size-5" /> : null}
            {saving ? t("review.saving") : t("review.save")}
          </button>
          {confirmed ? (
            <p className="inline-flex min-h-12 w-full items-center justify-center gap-2 font-semibold text-emerald-800 lg:w-auto lg:justify-start">
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
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400 lg:w-auto"
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

function hasDirtyLeaf(value: unknown): boolean {
  if (value === true) return true;
  return value !== null && typeof value === "object" && Object.values(value).some(hasDirtyLeaf);
}
