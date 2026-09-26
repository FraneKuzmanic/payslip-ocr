import type { ExportFormat, Payslip } from "@payslip/shared";

export function exportFilename(format: ExportFormat, now: Date): string {
  return `payslips-${now.toISOString().slice(0, 10)}.${format}`;
}

/**
 * One payslip's download name (plan 12 D9): its period and a short id, never a name. Filenames
 * surface in download bars and sync folders, and names and OIBs are personal data.
 */
export function payslipExportFilename(
  payslip: Pick<Payslip, "id" | "period">,
  format: ExportFormat,
): string {
  const period = payslip.period ? `${payslip.period}-` : "";
  return `payslip-${period}${payslip.id.slice(0, 8)}.${format}`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
