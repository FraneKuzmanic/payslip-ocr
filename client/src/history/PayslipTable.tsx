import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { ExportFormat, PayslipListItem } from "@payslip/shared";
import type { FormLanguage } from "../review/reviewForm";
import { PayslipActions } from "./PayslipActions";
import { rowAmount, rowPeriod, rowRoute, rowTitle, rowUploaded } from "./historyRow";

interface PayslipTableProps {
  items: PayslipListItem[];
  downloadingId: string | null;
  onDownload: (payslip: PayslipListItem, format: ExportFormat) => void;
  onDelete: (payslip: PayslipListItem) => void;
}

/**
 * The layout from `lg` up (plan 12 D7): one scannable column per value.
 *
 * `table-fixed` with explicit widths lets a long name truncate instead of widening the table into a
 * horizontal scrollbar. The container deliberately sets **no** `overflow`: an `overflow-x: auto`
 * ancestor also clips vertically and would cut off the row menu.
 */
export function PayslipTable({ items, downloadingId, onDownload, onDelete }: PayslipTableProps) {
  const { t, i18n } = useTranslation();
  const language: FormLanguage = i18n.language.startsWith("hr") ? "hr" : "en";
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("history.title")}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <th scope="col" className="w-28 px-4 py-3">
              {t("history.columns.period")}
            </th>
            <th scope="col" className="px-4 py-3">
              {t("history.columns.employee")}
            </th>
            <th scope="col" className="px-4 py-3">
              {t("history.columns.employer")}
            </th>
            <th scope="col" className="w-40 px-4 py-3 text-right">
              {t("history.columns.amount")}
            </th>
            <th scope="col" className="w-40 px-4 py-3">
              {t("history.columns.status")}
            </th>
            <th scope="col" className="w-32 px-4 py-3">
              {t("history.columns.uploaded")}
            </th>
            <th scope="col" className="w-16 px-2 py-3">
              <span className="sr-only">{t("history.columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((payslip) => (
            <tr
              key={payslip.id}
              onClick={(event) => {
                if (isInteractiveTarget(event.target)) return;
                void navigate(rowRoute(payslip));
              }}
              className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
            >
              <td className="truncate px-4 py-3 text-slate-600">
                {rowPeriod(payslip, language) ?? t("history.noPeriod")}
              </td>
              <th scope="row" className="px-4 py-0 text-left font-medium">
                {/* A flex link so the focusable control itself is 48 px tall, not just its row. */}
                <Link
                  to={rowRoute(payslip)}
                  className="flex min-h-12 items-center rounded outline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  <span className="min-w-0 truncate">{rowTitle(payslip, t)}</span>
                </Link>
              </th>
              <td className="truncate px-4 py-3 text-slate-600">{payslip.employerName}</td>
              <td className="truncate px-4 py-3 text-right font-medium text-slate-900 tabular-nums">
                {rowAmount(payslip, language) ?? t("history.noAmount")}
              </td>
              <td className="px-4 py-3">
                <span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {t(`historyStatus.${payslip.status}`)}
                </span>
              </td>
              <td className="truncate px-4 py-3 text-slate-600">
                {rowUploaded(payslip, language)}
              </td>
              <td className="px-2 py-3">
                <div className="flex justify-end">
                  <PayslipActions
                    payslip={payslip}
                    busy={downloadingId === payslip.id}
                    onDownload={onDownload}
                    onDelete={onDelete}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a, button") !== null;
}
