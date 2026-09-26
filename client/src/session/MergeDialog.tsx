import { ArrowUpDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isMergeable,
  mergeErrorCodeSchema,
  type MergeErrorCode,
  type PayslipSummary,
} from "@payslip/shared";
import { ApiError, mergePayslips } from "../api/client";
import { Spinner } from "../components/Spinner";
import { formatField } from "../review/reviewForm";
import { statusIcon } from "../review/PayslipRail";
import { SourceThumbnail } from "./SourceThumbnail";

type Pair = readonly [string, string];

interface MergeDialogProps {
  open: boolean;
  sessionId: string;
  payslips: readonly PayslipSummary[];
  /** The pair to confirm, from a suggestion; `null` asks the user to pick the second payslip. */
  pair: Pair | null;
  /** The payslip the pick step merges another one into. */
  selectedId: string;
  /** `originals` in page order, as sent. */
  onMerged: (id: string, originals: Pair) => void;
  /** A `409`: the list is stale, so the caller re-reads it and shows why. */
  onRefused: () => void;
  onClose: () => void;
}

/**
 * The merge confirmation (PRD §7.8, plan 11 D11). A native `<dialog>` opened with `showModal()`,
 * like `ConfirmDialog`, which it cannot reuse because it shows the two documents and a swap. The
 * pages start in upload order, and the consequence is stated in words: both payslips, with their
 * edits and confirmation, are replaced by a fresh extraction.
 */
export function MergeDialog({
  open,
  sessionId,
  payslips,
  pair,
  selectedId,
  onMerged,
  onRefused,
  onClose,
}: MergeDialogProps) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const index = (id: string) => payslips.findIndex((payslip) => payslip.id === id);
  const inListOrder = (a: string, b: string): Pair => (index(a) <= index(b) ? [a, b] : [b, a]);
  // Keyed per opening by the caller, so this state starts fresh each time the dialog opens.
  const [chosen, setChosen] = useState<string | null>(null);
  const [order, setOrder] = useState<Pair | null>(() => (pair ? inListOrder(...pair) : null));
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<MergeErrorCode | "network" | null>(null);
  const confirming = order !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      // Returns focus to whatever opened the dialog: the menu trigger or the banner's button.
      dialog.close();
    }
  }, [open]);

  // The pick step leaves focus with the dialog's default; the confirm step starts on Cancel.
  useEffect(() => {
    if (open && confirming) cancelRef.current?.focus();
  }, [open, confirming]);

  function cancel() {
    if (!busy) onClose();
  }

  async function merge() {
    if (busy || order === null) return;
    setBusy(true);
    setErrorCode(null);
    const payslipIds = inListOrder(order[0], order[1]);
    try {
      const { id } = await mergePayslips(sessionId, {
        payslipIds: [...payslipIds],
        order: [...order],
      });
      onMerged(id, order);
    } catch (error) {
      console.error("[merge] the merge request failed", error);
      const code = mergeErrorCodeSchema.safeParse(error instanceof ApiError ? error.code : null);
      setErrorCode(code.success ? code.data : "network");
      if (error instanceof ApiError && error.status === 409) onRefused();
    } finally {
      setBusy(false);
    }
  }

  function label(payslip: PayslipSummary): string {
    return payslip.period
      ? formatField("period", payslip.period, i18n.language.startsWith("hr") ? "hr" : "en")
      : payslip.originalFilename;
  }

  /** Where this document's pages land in the merged payslip. */
  function pagesOf(position: number, pageCount: number): string {
    const from = position === 0 ? 1 : (ordered[0]?.pageCount ?? 0) + 1;
    return pageCount === 1
      ? t("merge.pagePosition", { page: from })
      : t("merge.pageRange", { from, to: from + pageCount - 1 });
  }

  const candidates = payslips.filter(
    (payslip) => payslip.id !== selectedId && isMergeable(payslip.status, payslip.tablesStatus),
  );
  const ordered = (order ?? [])
    .map((id) => payslips.find((payslip) => payslip.id === id))
    .filter((payslip) => payslip !== undefined);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) cancel();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-900/40"
    >
      <h2 id={titleId} className="text-lg font-semibold text-slate-900">
        {confirming ? t("merge.title") : t("merge.pickTitle")}
      </h2>

      {confirming ? (
        <>
          <ol className="mt-4 flex flex-col gap-2">
            {ordered.map((payslip, position) => (
              <li key={payslip.id} className="flex flex-col gap-2">
                {position === 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (busy) return;
                      setOrder((current) => current && [current[1], current[0]]);
                      setSwapped(true);
                    }}
                    aria-disabled={busy}
                    className="inline-flex min-h-12 items-center justify-center gap-2 self-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400"
                  >
                    <ArrowUpDown aria-hidden="true" className="size-5" />
                    {t("merge.swap")}
                  </button>
                ) : null}
                <div className="flex gap-3 rounded-lg border border-slate-200 p-3">
                  <SourceThumbnail payslipId={payslip.id} />
                  <div className="flex min-w-0 flex-col gap-1 text-sm">
                    <p className="font-semibold">{pagesOf(position, payslip.pageCount)}</p>
                    <p>{t("session.position", { index: index(payslip.id) + 1 })}</p>
                    <p className="break-all text-slate-700">{payslip.originalFilename}</p>
                    <p className="text-slate-600">
                      {t("merge.pageCount", { count: payslip.pageCount })}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p role="status" className="sr-only">
            {swapped && ordered[0] ? t("merge.swapped", { index: index(ordered[0].id) + 1 }) : ""}
          </p>
          <p className="mt-4 text-sm text-slate-700">{t("merge.consequence")}</p>
        </>
      ) : (
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="mb-2 text-sm text-slate-700">{t("merge.pickLegend")}</legend>
          {candidates.map((payslip) => (
            <label
              key={payslip.id}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 px-3 py-2 text-sm has-checked:border-2 has-checked:border-accent"
            >
              <input
                type="radio"
                name="merge-with"
                value={payslip.id}
                checked={chosen === payslip.id}
                onChange={() => setChosen(payslip.id)}
                className="size-5 accent-accent"
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {t("session.position", { index: index(payslip.id) + 1 })}
                </span>
                <span className="truncate">{label(payslip)}</span>
                <span className="flex items-center gap-2">
                  {statusIcon(payslip)}
                  {t(`payslipStatus.${payslip.status}`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {errorCode === null ? null : (
        <p role="alert" className="mt-4 text-sm text-red-800">
          {t(`merge.errors.${errorCode}`)}
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          ref={cancelRef}
          onClick={cancel}
          aria-disabled={busy}
          className="min-h-12 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400"
        >
          {t("merge.cancel")}
        </button>
        {confirming ? (
          <button
            type="button"
            onClick={() => void merge()}
            aria-disabled={busy}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
          >
            {busy ? <Spinner label={false} /> : null}
            {t("merge.confirm")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (chosen !== null) setOrder(inListOrder(selectedId, chosen));
            }}
            aria-disabled={chosen === null}
            className="min-h-12 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
          >
            {t("merge.continue")}
          </button>
        )}
      </div>
    </dialog>
  );
}
