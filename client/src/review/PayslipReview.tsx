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
import { SourceDocumentPanel } from "./SourceDocumentPanel";

const TABLES = ["payComponents", "obustave", "neoporeziviPrimici"] as const;

interface PayslipPreviewProps {
  payslipId: string;
  /** A change reloads the regions, so the table outlines appear once the tables pass lands (D7). */
  tablesStatus: TablesStatus;
}

/**
 * One payslip's source with every extracted value outlined (Task 08). Read-only: an outline opens
 * the popover and there is no form to focus yet (D2).
 */
export function PayslipPreview({ payslipId, tablesStatus }: PayslipPreviewProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PayslipDetailResponse | null>(null);
  const [regions, setRegions] = useState<SourceRegionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        console.error("[review] could not load the payslip preview", error);
        setFailed(true);
      });
    return () => controller.abort();
  }, [payslipId, tablesStatus, attempt]);

  // A failed refetch keeps what is already shown and says so; only a first load has nothing to keep.
  if (detail === null || regions === null) {
    return failed ? (
      <ErrorMessage message={t("review.errors.load")} onRetry={() => setAttempt((n) => n + 1)} />
    ) : (
      <Spinner />
    );
  }

  return (
    <>
      {/* The poll has stopped by the time a refetch fails, so nothing else would try again. */}
      {failed ? (
        <div className="mb-3">
          <ErrorMessage
            message={t("review.errors.refresh")}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        </div>
      ) : null}
      <SourceDocumentPanel
        payslipId={payslipId}
        regions={regions}
        activeField={null}
        interaction="popover"
        fieldValues={fieldValuesOf(detail)}
        lowConfidenceFields={detail.lowConfidenceFields}
        ungroundableFields={detail.ungroundableFields}
        unreadableFields={detail.unreadableFields}
        editedFields={detail.editedFields}
        showTitle={false}
      />
    </>
  );
}

/**
 * Every non-null canonical value by dotted path (`netoPlaca`, `payComponents.2.iznos`), shown as
 * stored (D8). A null value is left out, so the popover says nothing was read.
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
