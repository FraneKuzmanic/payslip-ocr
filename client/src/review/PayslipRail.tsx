import { AlertCircle, CheckCircle2, Loader2, PencilLine } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PayslipSummary } from "@payslip/shared";

interface PayslipRailProps {
  payslips: readonly PayslipSummary[];
  selectedId: string | null;
  unsaved: ReadonlySet<string>;
  onSelect: (id: string) => void;
}

/**
 * Manual activation keeps arrow-key browsing from loading another review (Task 10 D7). The rail is
 * horizontal at every width since Task 14 D10.
 *
 * A payslip still being read has no form to open, so its chip is `aria-disabled` (Task 14 D10). It
 * stays focusable in the roving tablist, so arrow keys reach it and it is announced as unavailable,
 * as the APG tabs pattern allows; only activation is refused.
 *
 * There is no `+N` overflow badge (Task 15 D7); the next chip still peeks.
 */
export function PayslipRail({ payslips, selectedId, unsaved, onSelect }: PayslipRailProps) {
  const { t } = useTranslation();
  const tabs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    tabs.current.get(selectedId ?? "")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? payslips.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % payslips.length
            : event.key === "ArrowLeft"
              ? (index + payslips.length - 1) % payslips.length
              : null;
    if (target === null) return;
    event.preventDefault();
    const tab = tabs.current.get(payslips[target]!.id);
    tab?.focus();
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  return (
    <div
      role="tablist"
      aria-label={t("session.payslips")}
      aria-orientation="horizontal"
      className="-m-1 flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto p-1"
    >
      {payslips.map((payslip, index) => {
        const selected = payslip.id === selectedId;
        const unavailable = payslip.status === "processing";
        return (
          <button
            key={payslip.id}
            type="button"
            role="tab"
            id={`payslip-tab-${payslip.id}`}
            ref={(node) => {
              if (node) tabs.current.set(payslip.id, node);
              else tabs.current.delete(payslip.id);
            }}
            aria-selected={selected}
            aria-controls="payslip-panel"
            aria-disabled={unavailable}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => move(event, index)}
            // Enter and Space reach a button as a click, so this one guard covers all three.
            onClick={() => {
              if (!unavailable) onSelect(payslip.id);
            }}
            className={`flex min-h-12 min-w-0 shrink-0 snap-start flex-col gap-1 rounded-lg bg-white p-3 text-left text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60 lg:w-60 ${
              payslips.length > 2
                ? "w-[calc((100%-2.5rem)/2)]"
                : payslips.length === 2
                  ? "w-[calc((100%-0.5rem)/2)]"
                  : "w-full"
            } ${selected ? "border-2 border-accent" : "border border-slate-300"}`}
          >
            <span className={`flex min-w-0 items-center gap-2 ${selected ? "font-semibold" : ""}`}>
              <span className="block min-w-0 truncate">{payslip.originalFilename}</span>
              {unsaved.has(payslip.id) ? (
                <>
                  <PencilLine aria-hidden="true" className="size-4 shrink-0" />
                  <span className="sr-only">{t("session.unsaved")}</span>
                </>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              {statusIcon(payslip)}
              {t(`payslipStatus.${payslip.status}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function statusIcon(payslip: PayslipSummary): ReactNode {
  switch (payslip.status) {
    case "processing":
      return <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-slate-600" />;
    case "failed":
      return <AlertCircle aria-hidden="true" className="size-5 shrink-0 text-red-700" />;
    default:
      return <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-emerald-700" />;
  }
}
