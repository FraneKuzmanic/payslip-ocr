import { formatAmount, type PayslipListItem } from "@payslip/shared";
import type { TFunction } from "i18next";
import { formatField, type FormLanguage } from "../review/reviewForm";

/**
 * A history row's name, by the rail's rule (plan 12 D7): the employee once extraction has read
 * one, otherwise the file it came from. An older API sends no filename, hence the last fallback.
 */
export function rowTitle(
  item: Pick<PayslipListItem, "employeeName" | "originalFilename">,
  t: TFunction,
): string {
  return item.employeeName || item.originalFilename || t("history.untitled");
}

/** The period in the UI language's form (`06/2025` in hr), or `null` while unread. */
export function rowPeriod(
  item: Pick<PayslipListItem, "period">,
  language: FormLanguage,
): string | null {
  return item.period ? formatField("period", item.period, language) : null;
}

/** Iznos za isplatu, the figure on the bank statement (D7), or `null` while unread. */
export function rowAmount(
  item: Pick<PayslipListItem, "iznosZaIsplatu">,
  language: FormLanguage,
): string | null {
  return formatAmount(item.iznosZaIsplatu ?? null, { locale: language, currency: "EUR" });
}

/**
 * Every status opens in its session: the session page handles processing and failed ones. It opens
 * the single view (Task 15 D3); the upload view is the session URL without it.
 */
export function rowRoute(item: Pick<PayslipListItem, "id" | "sessionId">): string {
  return `/sessions/${encodeURIComponent(item.sessionId)}?payslip=${encodeURIComponent(item.id)}&view=single`;
}

/** The upload date, so "yesterday's payslips" can be recognised (D7). */
export function rowUploaded(
  item: Pick<PayslipListItem, "createdAt">,
  language: FormLanguage,
): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
    new Date(item.createdAt),
  );
}
