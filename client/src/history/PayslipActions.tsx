import { FileJson, FileSpreadsheet, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExportFormat, PayslipListItem } from "@payslip/shared";
import { ActionMenu, type ActionMenuItem } from "../components/ActionMenu";
import { rowTitle } from "./historyRow";

interface PayslipActionsProps {
  payslip: PayslipListItem;
  busy: boolean;
  onDownload: (payslip: PayslipListItem, format: ExportFormat) => void;
  onDelete: (payslip: PayslipListItem) => void;
}

/**
 * The per-payslip overflow menu, identical on a table row and on a card (plan 12 D5).
 *
 * Download appears only for a confirmed payslip (PRD §7.11): an unconfirmed extraction is a draft,
 * and a draft must not leave the application looking like reviewed data. The API refuses it too,
 * so this is presentation, not the guard.
 */
export function PayslipActions({ payslip, busy, onDownload, onDelete }: PayslipActionsProps) {
  const { t } = useTranslation();

  const items: ActionMenuItem[] = [
    ...(payslip.status === "confirmed"
      ? [
          {
            key: "csv",
            label: t("history.downloadCsv"),
            icon: FileSpreadsheet,
            onSelect: () => onDownload(payslip, "csv"),
          },
          {
            key: "json",
            label: t("history.downloadJson"),
            icon: FileJson,
            onSelect: () => onDownload(payslip, "json"),
          },
        ]
      : []),
    {
      key: "delete",
      label: t("history.delete"),
      icon: Trash2,
      destructive: true,
      onSelect: () => onDelete(payslip),
    },
  ];

  return (
    <ActionMenu
      id={`history-actions-${payslip.id}`}
      label={t("history.actionsFor", { name: rowTitle(payslip, t) })}
      items={items}
      busy={busy}
    />
  );
}
