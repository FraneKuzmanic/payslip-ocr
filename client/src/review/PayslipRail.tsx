import { AlertCircle, CheckCircle2, Loader2, PencilLine } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PayslipSummary } from "@payslip/shared";
import { formatField } from "./reviewForm";
import { overflowAfter } from "./stripGeometry";

interface PayslipRailProps {
  payslips: readonly PayslipSummary[];
  selectedId: string | null;
  unsaved: ReadonlySet<string>;
  orientation: "horizontal" | "vertical";
  onSelect: (id: string) => void;
}

/** Manual activation keeps arrow-key browsing from loading another review (Task 10 D7). */
export function PayslipRail({
  payslips,
  selectedId,
  unsaved,
  orientation,
  onSelect,
}: PayslipRailProps) {
  const { t, i18n } = useTranslation();
  const rail = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const [visible, setVisible] = useState<readonly boolean[]>([]);
  const horizontal = orientation === "horizontal";
  const overflow = horizontal ? overflowAfter(visible) : null;

  useEffect(() => {
    tabs.current.get(selectedId ?? "")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId, orientation]);

  useEffect(() => {
    setVisible([]);
    if (!horizontal || typeof IntersectionObserver === "undefined") return;
    const visibility = payslips.map(() => false);
    const indices = new Map(
      payslips.map((payslip, index) => [tabs.current.get(payslip.id), index]),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = indices.get(entry.target as HTMLButtonElement);
          if (index !== undefined) visibility[index] = entry.intersectionRatio >= 1;
        }
        setVisible([...visibility]);
      },
      { root: rail.current, threshold: 1 },
    );
    for (const tab of tabs.current.values()) observer.observe(tab);
    return () => observer.disconnect();
  }, [payslips, horizontal]);

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? payslips.length - 1
          : event.key === nextKey
            ? (index + 1) % payslips.length
            : event.key === previousKey
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
      ref={rail}
      role="tablist"
      aria-label={t("session.payslips")}
      aria-orientation={orientation}
      className={`-m-1 flex min-w-0 gap-2 p-1 ${horizontal ? "snap-x snap-mandatory overflow-x-auto" : "max-h-[calc(100dvh-6rem)] flex-col overflow-y-auto"}`}
    >
      {payslips.map((payslip, index) => {
        const selected = payslip.id === selectedId;
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
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => move(event, index)}
            onClick={() => onSelect(payslip.id)}
            className={`relative flex min-h-12 min-w-0 shrink-0 snap-start flex-col gap-1 rounded-lg bg-white p-3 text-left text-sm ${
              horizontal && payslips.length > 2
                ? "w-[calc((100%-2.5rem)/2)]"
                : horizontal && payslips.length === 2
                  ? "w-[calc((100%-0.5rem)/2)]"
                  : "w-full"
            } ${selected ? "border-2 border-accent" : "border border-slate-300"}`}
          >
            <span className={`flex items-center gap-2 ${selected ? "font-semibold" : ""}`}>
              {index + 1}
              {unsaved.has(payslip.id) ? (
                <>
                  <PencilLine aria-hidden="true" className="size-4" />
                  <span className="sr-only">{t("session.unsaved")}</span>
                </>
              ) : null}
            </span>
            <span className="block w-full truncate">
              {payslip.period
                ? formatField(
                    "period",
                    payslip.period,
                    i18n.language.startsWith("hr") ? "hr" : "en",
                  )
                : payslip.originalFilename}
            </span>
            <span className="flex items-center gap-2">
              {statusIcon(payslip)}
              {t(`payslipStatus.${payslip.status}`)}
            </span>
            {overflow?.index === index ? (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 rounded bg-slate-100 px-1 text-xs"
              >
                +{overflow.count}
              </span>
            ) : null}
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
