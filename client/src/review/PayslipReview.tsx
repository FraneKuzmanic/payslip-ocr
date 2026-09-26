import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  canonicalPayslipFieldsSchema,
  type PayslipDetailResponse,
  type SourceRegionsResponse,
  type TablesStatus,
} from "@payslip/shared";
import { getPayslipDetail, getPayslipRegions } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";
import { useWideLayout } from "../history/useWideLayout";
import { PayslipForm } from "./PayslipForm";
import { fieldId } from "./ReviewField";
import { SourceDocumentPanel } from "./SourceDocumentPanel";
import { useUnsavedEdits } from "./unsaved/useUnsavedEdits";
import { useSoftKeyboard } from "./useSoftKeyboard";

const TABLES = ["payComponents", "obustave", "neoporeziviPrimici"] as const;

interface PayslipReviewProps {
  payslipId: string;
  /** A change reloads detail and regions, so the tables fill in once their pass lands (Task 08 D7). */
  tablesStatus: TablesStatus;
  /** After a save or confirm, so the session page refreshes the payslip's row. */
  onChanged: () => void;
}

/**
 * One payslip's review (Task 09): the form beside its highlighted source, linked both ways.
 * Focusing a field makes its outline active, and the panel pans and switches page to it; an
 * outline focuses its input directly at `lg`, or through the popover's Edit on a phone (D9).
 *
 * One panel mount for both layouts (Task 08 D1): at `lg` it sits in a sticky column beside the
 * form; on a phone it is a disclosure above the form that hides rather than unmounts, so a PDF is
 * never rendered twice (D11).
 */
export function PayslipReview({ payslipId, tablesStatus, onChanged }: PayslipReviewProps) {
  const { t } = useTranslation();
  const wide = useWideLayout();
  const edits = useUnsavedEdits();
  // Initializers may run twice in StrictMode. Read without consuming until the form mounts.
  const [initialEdits] = useState(() => edits.peek(payslipId));
  const [detail, setDetail] = useState<PayslipDetailResponse | null>(null);
  const [regions, setRegions] = useState<SourceRegionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const keyboard = useSoftKeyboard(wide ? null : focusedPath);
  const formReady = detail !== null && regions !== null;
  useEffect(() => {
    if (formReady) edits.take(payslipId);
  }, [formReady, edits.take, payslipId]);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    // The previous detail and regions stay in place while this runs, so a tables-pass refetch never
    // remounts the panel, which would fetch the source and render the PDF again.
    Promise.all([
      getPayslipDetail(payslipId, controller.signal),
      getPayslipRegions(payslipId, controller.signal),
    ])
      .then(([nextDetail, nextRegions]) => {
        if (controller.signal.aborted) return;
        setDetail(nextDetail);
        setRegions(nextRegions);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[review] could not load the payslip review", error);
        setFailed(true);
      });
    return () => controller.abort();
  }, [payslipId, tablesStatus, attempt]);

  /** Region → field: the input exists for every path a region can name (Task 08 D7). */
  function selectRegion(path: string) {
    setActiveField(path);
    const input = document.getElementById(fieldId(path));
    input?.focus();
    // jsdom has no `scrollIntoView`.
    input?.scrollIntoView?.({ block: "center" });
  }

  // A failed refetch keeps what is already shown and says so; only a first load has nothing to keep.
  if (detail === null || regions === null) {
    return failed ? (
      <ErrorMessage message={t("review.errors.load")} onRetry={() => setAttempt((n) => n + 1)} />
    ) : (
      <Spinner />
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <PayslipForm
          detail={detail}
          initialEdits={initialEdits}
          onClose={(kept) => edits.keep(payslipId, kept)}
          onSaved={(next) => {
            edits.keep(payslipId, null);
            setDetail(next);
            onChanged();
          }}
          onConfirmed={(next) => {
            setDetail((current) =>
              current === null
                ? current
                : { ...current, status: next.status, confirmedAt: next.confirmedAt },
            );
            onChanged();
          }}
          onDirtyChange={(dirty) => edits.markUnsaved(payslipId, dirty)}
          onFieldFocus={(path) => {
            setActiveField(path);
            setFocusedPath(path);
          }}
        />
      </div>
      {/* Form first in Tab order; CSS puts the source above it on a phone (Task 10 D8). */}
      <aside
        aria-label={t("review.sourceTitle")}
        className="order-first flex min-w-0 flex-col gap-3 lg:order-none lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1"
      >
        {keyboard ? null : (
          <button
            type="button"
            onClick={() => setPreviewOpen((open) => !open)}
            aria-expanded={previewOpen}
            aria-controls="payslip-source"
            className="flex min-h-12 items-center justify-center self-start rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 lg:hidden"
          >
            {previewOpen ? t("session.hideDocument") : t("session.showDocument")}
          </button>
        )}
        <div id="payslip-source" className={previewOpen || keyboard ? "" : "hidden lg:block"}>
          {/* The poll has stopped by the time a refetch fails, so nothing else would try again. */}
          {failed ? (
            <div className="mb-3">
              <ErrorMessage
                message={t("review.errors.refresh")}
                onRetry={() => setAttempt((n) => n + 1)}
              />
            </div>
          ) : null}
          {/* Outlines, dashes and signals follow the saved detail, not keystrokes. */}
          <SourceDocumentPanel
            strip={keyboard}
            payslipId={payslipId}
            regions={liveRegions(regions, detail)}
            activeField={activeField}
            interaction={wide ? "focus" : "popover"}
            fieldValues={fieldValuesOf(detail)}
            lowConfidenceFields={detail.lowConfidenceFields}
            ungroundableFields={detail.ungroundableFields}
            unreadableFields={detail.unreadableFields}
            editedFields={detail.editedFields}
            onSelect={selectRegion}
            showTitle={false}
          />
        </div>
      </aside>
    </div>
  );
}

/**
 * The regions whose rows still exist in the saved payslip. A removed row has no input to focus,
 * so its outline would only point at nothing (Task 09 D6).
 */
export function liveRegions(
  regions: SourceRegionsResponse,
  detail: PayslipDetailResponse,
): SourceRegionsResponse {
  const live = (path: string) => {
    const [table, index] = path.split(".");
    if (!(TABLES as readonly string[]).includes(table ?? "")) return true;
    return Number(index) < (detail[table as (typeof TABLES)[number]] ?? []).length;
  };
  return {
    ...regions,
    regions: regions.regions
      .map((region) => ({ ...region, fields: region.fields.filter(live) }))
      .filter((region) => region.fields.length > 0),
  };
}

/**
 * Every non-null canonical value by dotted path (`netoPlaca`, `payComponents.2.iznos`), shown as
 * stored (Task 08 D8). A null value is left out, so the popover says nothing was read.
 */
export function fieldValuesOf(detail: PayslipDetailResponse): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of Object.keys(canonicalPayslipFieldsSchema.shape)) {
    if ((TABLES as readonly string[]).includes(name)) continue;
    const value: unknown = detail[name as keyof PayslipDetailResponse];
    if (typeof value === "string") values[name] = value;
  }
  for (const table of TABLES) {
    (detail[table] ?? []).forEach((row, index) => {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value === "string") values[`${table}.${index}.${column}`] = value;
      }
    });
  }
  return values;
}
