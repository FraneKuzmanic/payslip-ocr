// Task 12 re-derives the format from its export DTOs; until then the two PRD §7.11 formats.
export function exportFilename(format: "csv" | "json", now: Date): string {
  return `payslips-${now.toISOString().slice(0, 10)}.${format}`;
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
