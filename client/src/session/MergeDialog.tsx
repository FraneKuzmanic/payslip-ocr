import { ArrowDown, ArrowUp } from "lucide-react";
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

interface MergeDialogProps {
  open: boolean;
  sessionId: string;
  payslips: readonly PayslipSummary[];
  /** The group to confirm, from a suggestion; `null` asks the user to pick the others. */
  group: readonly string[] | null;
  /** The payslip the pick step merges the others into. */
  selectedId: string;
  /** `originals` in page order, as sent. */
  onMerged: (id: string, originals: readonly string[]) => void;
  /** A `409`: the list is stale, so the caller re-reads it and shows why. */
  onRefused: () => void;
  onClose: () => void;
}

/**
 * The merge confirmation (PRD §7.8, plan 11 D11, Task 15b D6). A native `<dialog>` opened with
 * `showModal()`, like `ConfirmDialog`, which it cannot reuse because it shows the documents and
 * reorders them. The pick step takes one or more other payslips; the confirm step lists two or
 * more documents in upload order, reordered with Move up / Move down, the single-pointer
 * alternative to dragging (WCAG 2.2 SC 2.5.7, locked decision 4). No warning paragraph (Task 15
 * D5): the pages and their order are the confirmation.
 */
export function MergeDialog({
  open,
  sessionId,
  payslips,
  group,
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
  const inListOrder = (ids: readonly string[]) => ids.toSorted((a, b) => index(a) - index(b));
  // Keyed per opening by the caller, so this state starts fresh each time the dialog opens.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [order, setOrder] = useState<readonly string[] | null>(() =>
    group ? inListOrder(group) : null,
  );
  // The last move, so its button keeps focus and the status line can announce it.
  const [moved, setMoved] = useState<{ id: string; direction: "up" | "down" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<MergeErrorCode | "network" | null>(null);
  const confirming = order !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      // Returns focus to whatever opened the dialog: the Merge button or the banner's button.
      dialog.close();
    }
  }, [open]);

  // The pick step leaves focus with the dialog's default; the confirm step starts on Cancel.
  useEffect(() => {
    if (open && confirming) cancelRef.current?.focus();
  }, [open, confirming]);

  // Moving a card moves its DOM node, which can blur the pressed button: focus it again, even when
  // it has just become aria-disabled at an end, since it stays focusable.
  useEffect(() => {
    if (moved) document.getElementById(`merge-move-${moved.direction}-${moved.id}`)?.focus();
  }, [moved, order]);

  function move(id: string, direction: "up" | "down") {
    if (busy || order === null) return;
    const from = order.indexOf(id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to]!, next[from]!];
    setOrder(next);
    setMoved({ id, direction });
  }

  function cancel() {
    if (!busy) onClose();
  }

  async function merge() {
    if (busy || order === null) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const { id } = await mergePayslips(sessionId, {
        payslipIds: inListOrder(order),
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

  function period(payslip: PayslipSummary): string | null {
    return payslip.period
      ? formatField("period", payslip.period, i18n.language.startsWith("hr") ? "hr" : "en")
      : null;
  }

  /** Where this document's pages land in the merged payslip: after every document above it. */
  function pagesOf(position: number, pageCount: number): string {
    const from =
      1 + ordered.slice(0, position).reduce((pages, payslip) => pages + payslip.pageCount, 0);
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
              <li
                key={payslip.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
              >
                <SourceThumbnail payslipId={payslip.id} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <p className="font-semibold">{pagesOf(position, payslip.pageCount)}</p>
                  <p className="break-all text-slate-700">{payslip.originalFilename}</p>
                  <p className="text-slate-600">
                    {t("merge.pageCount", { count: payslip.pageCount })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col">
                  {(["up", "down"] as const).map((direction) => {
                    const atEnd =
                      direction === "up" ? position === 0 : position === ordered.length - 1;
                    const Icon = direction === "up" ? ArrowUp : ArrowDown;
                    return (
                      <button
                        key={direction}
                        type="button"
                        id={`merge-move-${direction}-${payslip.id}`}
                        onClick={() => move(payslip.id, direction)}
                        aria-label={t(direction === "up" ? "merge.moveUp" : "merge.moveDown", {
                          name: payslip.originalFilename,
                        })}
                        aria-disabled={busy || atEnd}
                        className="grid size-12 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-300 aria-disabled:hover:bg-transparent"
                      >
                        <Icon aria-hidden="true" className="size-5" />
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          <p role="status" className="sr-only">
            {moved === null
              ? ""
              : t("merge.moved", {
                  name: payslips[index(moved.id)]?.originalFilename ?? "",
                  position: (order?.indexOf(moved.id) ?? 0) + 1,
                })}
          </p>
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
                type="checkbox"
                name="merge-with"
                value={payslip.id}
                checked={chosen.has(payslip.id)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(payslip.id);
                  else next.delete(payslip.id);
                  setChosen(next);
                }}
                className="size-5 accent-accent"
              />
              <span className="flex min-w-0 flex-col">
                {/* The file name, as on the chips (Task 14 D11); the period only when read. */}
                <span className="truncate font-semibold">{payslip.originalFilename}</span>
                {period(payslip) === null ? null : (
                  <span className="truncate">{period(payslip)}</span>
                )}
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
              if (chosen.size > 0) setOrder(inListOrder([selectedId, ...chosen]));
            }}
            aria-disabled={chosen.size === 0}
            className="min-h-12 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
          >
            {t("merge.continue")}
          </button>
        )}
      </div>
    </dialog>
  );
}
