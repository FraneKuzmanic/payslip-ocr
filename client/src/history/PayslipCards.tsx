import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ExportFormat, PayslipListItem } from "@payslip/shared";
import type { FormLanguage } from "../review/reviewForm";
import { PayslipActions } from "./PayslipActions";
import { rowAmount, rowPeriod, rowRoute, rowTitle, rowUploaded } from "./historyRow";

interface PayslipCardsProps {
  items: PayslipListItem[];
  downloadingId: string | null;
  onDownload: (payslip: PayslipListItem, format: ExportFormat) => void;
  onDelete: (payslip: PayslipListItem) => void;
}

/** The phone layout: one card per payslip, opening its session, with the row menu beside it. */
export function PayslipCards({ items, downloadingId, onDownload, onDelete }: PayslipCardsProps) {
  const { t, i18n } = useTranslation();
  const language: FormLanguage = i18n.language.startsWith("hr") ? "hr" : "en";

  return (
    <ul className="flex flex-col gap-3">
      {items.map((payslip) => (
        <li
          key={payslip.id}
          className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <Link
            to={rowRoute(payslip)}
            className="block min-w-0 flex-1 rounded-lg outline-offset-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{rowTitle(payslip, t)}</p>
                {payslip.employerName ? (
                  <p className="mt-1 truncate text-sm text-slate-600">{payslip.employerName}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {t(`payslipStatus.${payslip.status}`)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600">
              <span>{rowPeriod(payslip, language) ?? t("history.noPeriod")}</span>
              <span className="text-right font-medium text-slate-900 tabular-nums">
                {rowAmount(payslip, language) ?? t("history.noAmount")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t("history.uploadedOn", { date: rowUploaded(payslip, language) })}
            </p>
          </Link>

          <PayslipActions
            payslip={payslip}
            busy={downloadingId === payslip.id}
            onDownload={onDownload}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}
