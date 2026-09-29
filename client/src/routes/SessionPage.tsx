import {
  AlertCircle,
  ChevronLeft,
  Clock,
  Combine,
  FileJson,
  FileSpreadsheet,
  Loader2,
  X,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
  isMergeable,
  isRetryableFailure,
  mergedFilename,
  type ExportFormat,
  type PayslipSummary,
  type SessionDetailResponse,
} from "@payslip/shared";
import { ApiError, exportPayslip, getSessionDetail, retryPayslip } from "../api/client";
import { ActionMenu, type ActionMenuItem } from "../components/ActionMenu";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";
import { payslipExportFilename, saveBlob } from "../history/download";
import { PayslipRail } from "../review/PayslipRail";
import { PayslipReview } from "../review/PayslipReview";
import { useUnsavedEdits } from "../review/unsaved/useUnsavedEdits";
import { MergeDialog } from "../session/MergeDialog";
import { MergeSuggestions } from "../session/MergeSuggestions";
import type { BatchItem } from "../upload/UploadBatchContext";
import { useUploadBatch } from "../upload/useUploadBatch";

export const POLL_INTERVAL_MS = 2_000;

type LoadState = "loading" | "ready" | "not_found" | "error";

/** D7: nothing further will change without the user acting. The same rule as a merge (plan 11 D3). */
function isSettled(payslip: PayslipSummary): boolean {
  return isMergeable(payslip.status, payslip.tablesStatus);
}

/** The Merge button needs this payslip and another one to be mergeable (plan 11 D11, Task 15 D4). */
function canMerge(selected: PayslipSummary, payslips: readonly PayslipSummary[]): boolean {
  return (
    isSettled(selected) &&
    payslips.some((payslip) => payslip.id !== selected.id && isSettled(payslip))
  );
}

function isUnsent(item: BatchItem): boolean {
  return item.state === "waiting" || item.state === "uploading";
}

const linkClass =
  "flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100";
const iconClass = "size-5 shrink-0";

/** A payslip with a readable form, and so a review to open (Task 08 D1, Task 09 D11). */
function isReadable(payslip: PayslipSummary): boolean {
  return payslip.status === "review" || payslip.status === "confirmed";
}

/**
 * A payslip whose chip opens (Task 14 D8, D10): a readable one, or a failed one, which is a
 * finished result the user can act on (retry, merge) and must not wait behind a sibling.
 */
function isOpenable(payslip: PayslipSummary): boolean {
  return isReadable(payslip) || payslip.status === "failed";
}

/**
 * A session's manual-activation payslip rail and selected review (Task 10 D7).
 * The upload batch and unsaved edits live above this route, so navigation cannot discard either.
 */
export function SessionPage() {
  const { t } = useTranslation();
  const { sessionId = "" } = useParams();
  const { itemsFor, dismiss, markListed } = useUploadBatch();
  const { unsaved, keep } = useUnsavedEdits();
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshKey, setRefreshKey] = useState(0);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const [retryFailed, setRetryFailed] = useState<ReadonlySet<string>>(new Set());
  // `group: null` opens the dialog at its pick step. `opened` keys each opening (plan 11 D11).
  const [merge, setMerge] = useState<{ group: readonly string[] | null } | null>(null);
  const [mergeOpened, setMergeOpened] = useState(0);
  const [downloading, setDownloading] = useState(false);
  // The payslip whose download failed, so the message does not follow the user to another one.
  const [exportFailedId, setExportFailedId] = useState<string | null>(null);
  const [lastMerge, setLastMerge] = useState<{
    id: string;
    originals: readonly string[];
  } | null>(null);
  // The selection lives in the URL, so it survives a reload and the back button (D1).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("payslip");
  // Task 15 D3: a Payslips link opens one payslip alone, without the upload's rail or merge.
  const single = searchParams.get("view") === "single";

  const items = itemsFor(sessionId);
  const unsent = items.some(isUnsent);
  // Read by the poll loop without restarting it; the loop decides when to stop.
  const unsentRef = useRef(unsent);
  useEffect(() => {
    unsentRef.current = unsent;
  }, [unsent]);
  // Each upload that lands is fetched at once rather than on the next tick (D7).
  const uploadedCount = items.filter((item) => item.state === "uploaded").length;

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;
    let controller: AbortController | undefined;

    async function poll() {
      controller = new AbortController();
      try {
        const next = await getSessionDetail(sessionId, controller.signal);
        if (cancelled) return;
        setDetail(next);
        setLoadState("ready");

        // No client-side timeout (D7): this very read runs the API's stale reaper, which fails
        // anything stuck for 15 minutes, so polling always ends in a settled state.
        if (next.payslips.every(isSettled) && !unsentRef.current) return;
        pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch (error) {
        // An abort on unmount is expected; `request()` has already logged any API failure.
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setLoadState("not_found");
          return;
        }
        console.error("[session] polling stopped after an unexpected error", error);
        setLoadState("error");
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      controller?.abort();
    };
  }, [sessionId, refreshKey, uploadedCount]);

  async function retry(id: string) {
    if (retrying.has(id)) return;
    setRetrying((ids) => new Set(ids).add(id));
    setRetryFailed((ids) => without(ids, id));
    try {
      await retryPayslip(id);
      setDetail((current) =>
        current === null
          ? current
          : {
              ...current,
              payslips: current.payslips.map((payslip) =>
                payslip.id === id
                  ? {
                      ...payslip,
                      status: "processing",
                      tablesStatus: "pending",
                      failureReason: null,
                    }
                  : payslip,
              ),
            },
      );
      // The status panel loses its retry button; its tab remains throughout extraction.
      document.getElementById(`payslip-tab-${id}`)?.focus();
      setRefreshKey((key) => key + 1);
    } catch (error) {
      // 409: another retry already won, or the payslip moved on. The next read shows which.
      if (error instanceof ApiError && error.status === 409) {
        setRefreshKey((key) => key + 1);
      } else {
        console.error("[session] retry request failed", error);
        setRetryFailed((ids) => new Set(ids).add(id));
      }
    } finally {
      setRetrying((ids) => without(ids, id));
    }
  }

  /** Plan 12 D5: the saved payslip, which a confirmed payslip always is after its last save. */
  async function download(payslip: PayslipSummary, format: ExportFormat) {
    if (downloading) return;
    setDownloading(true);
    setExportFailedId(null);
    try {
      const blob = await exportPayslip(payslip.id, format);
      saveBlob(blob, payslipExportFilename(payslip, format));
    } catch (error) {
      console.error(`[session] exporting the payslip as ${format} failed`, error);
      setExportFailedId(payslip.id);
    } finally {
      setDownloading(false);
    }
  }

  function openMerge(group: readonly string[] | null) {
    setMerge({ group });
    setMergeOpened((count) => count + 1);
  }

  /**
   * Plan 11 D11: the merged payslip takes the earliest original's place and is selected.
   * `originals` are in page order, two or more (Task 15b D4).
   */
  function merged(id: string, originals: readonly string[]) {
    setMerge(null);
    // One transition for the list, the URL and the focus: the router applies a navigation in a
    // transition, so the list updated outside it would render first, without the selected
    // original, and the first-payslip selection below would take over the URL (Task 15b).
    startTransition(() => {
      setDetail((current) => {
        if (current === null) return current;
        const replaced = current.payslips.filter((payslip) => originals.includes(payslip.id));
        const named = (payslipId: string) =>
          replaced.find((payslip) => payslip.id === payslipId)?.originalFilename ?? "";
        // Shown until the next read, which the refresh below starts at once.
        const placeholder: PayslipSummary = {
          id,
          status: "processing",
          tablesStatus: "pending",
          period: null,
          employeeName: null,
          pageCount: replaced.reduce((pages, payslip) => pages + payslip.pageCount, 0),
          failureReason: null,
          warningCount: 0,
          originalFilename: mergedFilename(originals.map(named)),
        };
        const position = current.payslips.findIndex((payslip) => originals.includes(payslip.id));
        const payslips = current.payslips.filter((payslip) => !originals.includes(payslip.id));
        payslips.splice(position, 0, placeholder);
        return { ...current, payslips };
      });
      setSearchParams({ payslip: id }, { replace: true });
      setLastMerge({ id, originals });
    });
    setRefreshKey((key) => key + 1);
  }

  // An effect, not the handler: the closing review hands its unsaved edits to `keep` in its unmount
  // cleanup, which runs before this parent effect in the same commit, so this clears them last.
  // The dialog's own effect has closed it by then; its opener may be gone, so focus moves to the
  // merged payslip's tab, as after a retry.
  useEffect(() => {
    if (lastMerge === null) return;
    for (const id of lastMerge.originals) keep(id, null);
    document.getElementById(`payslip-tab-${lastMerge.id}`)?.focus();
  }, [lastMerge, keep]);

  // Task 15 D2: once a read includes an upload's payslip, the read represents it for good.
  useEffect(() => {
    if (detail) markListed(sessionId, new Set(detail.payslips.map((payslip) => payslip.id)));
  }, [detail, sessionId, markListed]);

  const selected = detail?.payslips.find((payslip) => payslip.id === selectedId) ?? null;

  // Task 14 D9: without a valid `?payslip=`, open the first payslip that has something to show,
  // preferring a form over a failure. Nothing is chosen while nothing is openable; the loading
  // screen covers that. An explicit `?payslip=` naming a payslip still being read is respected.
  // The single view never rewrites its URL (Task 15 D3).
  useEffect(() => {
    if (single || selected !== null || detail === null) return;
    const first = detail.payslips.find(isReadable) ?? detail.payslips.find(isOpenable);
    if (first) setSearchParams({ payslip: first.id }, { replace: true });
  }, [detail, selectedId, setSearchParams, single]);

  const payslips = detail?.payslips ?? [];
  const listed = new Set(payslips.map((payslip) => payslip.id));
  // An uploaded item is represented by its server row once a session read includes it, and stays
  // handed over after that (Task 15 D2): a merged or deleted payslip leaves the read for good, and
  // its item would otherwise come back as "Processing" and be counted.
  const pending = items.filter(
    (item) => !item.listed && (item.state !== "uploaded" || !listed.has(item.payslipId ?? "")),
  );
  // Task 14 D8: a full-screen wait until the first payslip has something to show, while anything is
  // still on its way. With every payslip failed or every upload rejected, the page shows at once.
  // Any `?payslip=` skips it, not only a valid one: until Task 15b a merge replaced the rows one
  // render before the URL, and the screen flashed and took the merged tab's focus with it.
  const inFlight =
    payslips.some((payslip) => payslip.status === "processing") ||
    pending.some((item) => item.state !== "rejected");
  const preparing =
    loadState === "loading" ||
    (loadState === "ready" && selectedId === null && !payslips.some(isOpenable) && inFlight);

  if (preparing) {
    return (
      <section
        aria-live="polite"
        className="mx-auto flex min-h-[calc(100svh-3.5rem-4rem)] max-w-lg flex-col items-center justify-center gap-3 px-4 py-12 text-center lg:min-h-[calc(100svh-4rem)]"
      >
        <Spinner />
        <h1 className="text-2xl font-semibold">{t("session.preparingTitle")}</h1>
        <p className="text-slate-600">{t("session.preparingDescription")}</p>
      </section>
    );
  }

  if (loadState === "not_found") {
    return (
      <section className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
        <p role="alert" className="text-slate-700">
          {t("session.notFound")}
        </p>
        <Link to="/" className={linkClass}>
          {t("session.scanMore")}
        </Link>
      </section>
    );
  }

  if (single && loadState === "ready" && selected === null) {
    return (
      <section className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
        <p role="alert" className="text-slate-700">
          {t("session.payslipNotFound")}
        </p>
        <Link to="/payslips" className={linkClass}>
          {t("review.backToPayslips")}
        </Link>
      </section>
    );
  }

  // Plan 12 D5: downloads once the selected payslip is confirmed. Merge is a button (Task 15 D4).
  const actions: ActionMenuItem[] =
    selected?.status === "confirmed"
      ? [
          {
            key: "csv",
            label: t("history.downloadCsv"),
            icon: FileSpreadsheet,
            onSelect: () => void download(selected, "csv"),
          },
          {
            key: "json",
            label: t("history.downloadJson"),
            icon: FileJson,
            onSelect: () => void download(selected, "json"),
          },
        ]
      : [];
  const actionMenu =
    actions.length > 0 ? (
      <ActionMenu
        id="payslip-actions"
        label={t("merge.actions")}
        items={actions}
        busy={downloading}
      />
    ) : null;
  const ready = payslips.filter((payslip) => payslip.status === "review").length;
  const confirmed = payslips.filter((payslip) => payslip.status === "confirmed").length;
  const total = payslips.length + pending.filter((item) => item.state !== "rejected").length;
  const progress = [
    ...(ready === 0 && confirmed > 0 ? [] : [t("session.progress", { ready, total })]),
    ...(confirmed > 0 ? [t("session.confirmedCount", { count: confirmed, total })] : []),
  ].join(" · ");

  return (
    // Task 14 D12: the full main width at `lg`, so the document column gains width on wide screens.
    <section
      className={`mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8 ${
        payslips.length === 0 ? "" : "lg:max-w-none"
      }`}
    >
      <div className="flex flex-col gap-2">
        {/* 48 px tall for the target-size rule (PRD §11.5), which receipt-ocr's link predates. */}
        <Link
          to="/payslips"
          className="inline-flex min-h-12 w-fit items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {t("review.backToPayslips")}
        </Link>
        {single && selected !== null ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-2xl font-semibold break-all">{selected.originalFilename}</h1>
              {actionMenu}
            </div>
            <p role="status" className="text-slate-600">
              {t(`historyStatus.${selected.status}`)}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{t("session.title", { count: total })}</h1>
            <p role="status" className="text-slate-600">
              {progress}
            </p>
          </>
        )}
      </div>

      {loadState === "error" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <p role="alert">{t("session.loadError")}</p>
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            className="min-h-12 self-start rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover"
          >
            {t("session.retry")}
          </button>
        </div>
      ) : null}

      {!single && payslips.length > 1 ? (
        <MergeSuggestions
          groups={detail?.mergeSuggestions ?? []}
          payslips={payslips}
          onReview={openMerge}
        />
      ) : null}

      {/* The rail sits above the selected payslip at every width (Task 14 D10, D12). */}
      {payslips.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-5">
          {single ? null : (
            <PayslipRail
              payslips={payslips}
              selectedId={selected?.id ?? null}
              unsaved={unsaved}
              onSelect={(id) => {
                if (id !== selectedId) setSearchParams({ payslip: id });
              }}
            />
          )}
          {selected === null ? null : (
            // The single view has no tab, so its panel is a plain container (Task 15 D3).
            <div
              {...(single
                ? {}
                : {
                    role: "tabpanel",
                    id: "payslip-panel",
                    tabIndex: 0,
                    "aria-labelledby": `payslip-tab-${selected.id}`,
                  })}
              className="flex min-w-0 flex-col gap-3"
            >
              {single ? null : (
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold break-all">{selected.originalFilename}</h2>
                  <div className="flex shrink-0 items-center gap-2">
                    {canMerge(selected, payslips) ? (
                      // Task 15 D4: visible, not an item hidden in the menu. Task 15b D3: one short
                      // label at every width, the long form as its tooltip.
                      <button
                        type="button"
                        onClick={() => openMerge(null)}
                        title={t("merge.mergeWith")}
                        className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Combine aria-hidden="true" className="size-5" />
                        {t("merge.mergeShort")}
                      </button>
                    ) : null}
                    {actionMenu}
                  </div>
                </div>
              )}
              {exportFailedId === selected.id ? (
                <ErrorMessage message={t("history.errors.export")} />
              ) : null}
              {isReadable(selected) ? (
                <PayslipReview
                  key={selected.id}
                  payslipId={selected.id}
                  tablesStatus={selected.tablesStatus}
                  onChanged={() => setRefreshKey((key) => key + 1)}
                />
              ) : selected.status === "processing" ? (
                <p role="status" className="text-slate-600">
                  {t("session.processingPanel")}
                </p>
              ) : (
                <>
                  {selected.failureReason ? (
                    <p className="text-red-800">{t(`failureReason.${selected.failureReason}`)}</p>
                  ) : null}
                  {retryFailed.has(selected.id) ? (
                    <p role="alert" className="text-red-800">
                      {t("session.retryError")}
                    </p>
                  ) : null}
                  {selected.failureReason && isRetryableFailure(selected.failureReason) ? (
                    <button
                      type="button"
                      onClick={() => void retry(selected.id)}
                      aria-disabled={retrying.has(selected.id)}
                      className="flex min-h-12 items-center gap-2 self-start rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
                    >
                      {retrying.has(selected.id) ? (
                        <Spinner label={false} className="size-5" />
                      ) : null}
                      {t("session.retry")}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {!single && pending.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {pending.map((item) => (
            <Row
              key={item.localId}
              name={item.name}
              detail={null}
              icon={batchIcon(item)}
              status={
                item.state === "waiting"
                  ? t("session.waiting")
                  : item.state === "rejected"
                    ? item.errorCode === undefined || item.errorCode === "network"
                      ? t("session.uploadNetworkError")
                      : t(`upload.${item.errorCode}`)
                    : item.state === "uploading"
                      ? t("session.uploading")
                      : t("payslipStatus.processing")
              }
            >
              {item.state === "rejected" ? (
                <button
                  type="button"
                  onClick={() => dismiss(sessionId, item.localId)}
                  aria-label={t("session.dismiss", { name: item.name })}
                  className="grid min-h-12 min-w-12 place-items-center self-start rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              ) : null}
            </Row>
          ))}
        </ol>
      ) : null}

      {single || selected === null ? null : (
        <MergeDialog
          key={mergeOpened}
          open={merge !== null}
          sessionId={sessionId}
          payslips={payslips}
          group={merge?.group ?? null}
          selectedId={selected.id}
          onMerged={merged}
          onRefused={() => setRefreshKey((key) => key + 1)}
          onClose={() => setMerge(null)}
        />
      )}
    </section>
  );
}

interface RowProps {
  readonly name: string;
  readonly detail: string | null;
  readonly icon: ReactNode;
  readonly status: string;
  readonly children?: ReactNode;
}

function Row({ name, detail, icon, status, children }: RowProps) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <p className="font-medium break-all">{name}</p>
      {detail ? <p className="text-slate-700">{detail}</p> : null}
      {/* The icon is decorative: the text beside it carries the status, never colour alone. */}
      <p className="flex items-center gap-2">
        {icon}
        {status}
      </p>
      {children}
    </li>
  );
}

function batchIcon(item: BatchItem): ReactNode {
  switch (item.state) {
    case "waiting":
      return <Clock aria-hidden="true" className={`${iconClass} text-slate-600`} />;
    case "rejected":
      return <AlertCircle aria-hidden="true" className={`${iconClass} text-red-700`} />;
    default:
      return <Loader2 aria-hidden="true" className={`${iconClass} animate-spin text-slate-600`} />;
  }
}

function without(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}
