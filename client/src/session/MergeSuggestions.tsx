import { Combine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PayslipSummary } from "@payslip/shared";
import { suggestionKey, useDismissedSuggestions } from "./dismissedSuggestions";

const MAX_NAME = 40;

/**
 * A file name short enough for a one-line banner (Task 14 D11): the middle is elided and the
 * extension kept, so `very_long_…_scan.jpg` still says what kind of file it is.
 */
export function shortName(name: string, max = MAX_NAME): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  const stem = name.slice(0, name.length - extension.length);
  const room = max - 1 - extension.length;
  const head = Math.ceil(room / 2);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - (room - head))}${extension}`;
}

interface MergeSuggestionsProps {
  groups: readonly (readonly string[])[];
  payslips: readonly PayslipSummary[];
  onReview: (group: readonly string[]) => void;
}

/**
 * One non-blocking banner per suggested group of two or more (PRD §7.8, plan 11 D11, Task 15b D7).
 * Never merges by itself: Review merge opens the confirmation, Not now hides the group for this
 * tab (D6).
 */
export function MergeSuggestions({ groups, payslips, onReview }: MergeSuggestionsProps) {
  const { t } = useTranslation();
  const { dismissed, dismiss } = useDismissedSuggestions();
  const position = (id: string) => payslips.findIndex((payslip) => payslip.id === id) + 1;
  const name = (id: string) =>
    shortName(payslips.find((payslip) => payslip.id === id)?.originalFilename ?? "");
  // A group with a payslip just merged or deleted is stale until the next read.
  const shown = groups.filter(
    (group) => !dismissed.has(suggestionKey(group)) && group.every((id) => position(id) > 0),
  );
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {shown.map((group) => (
        <div
          key={suggestionKey(group)}
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2">
            <Combine aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t("merge.suggestion", { names: group.map(name) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onReview(group)}
              className="min-h-12 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {t("merge.reviewSuggestion")}
            </button>
            <button
              type="button"
              onClick={() => dismiss(suggestionKey(group))}
              className="min-h-12 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t("merge.dismissSuggestion")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
