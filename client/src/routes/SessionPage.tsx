import { AlertCircle, Clock, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
  isRetryableFailure,
  type PayslipSummary,
  type SessionDetailResponse,
} from "@payslip/shared";
import { ApiError, getSessionDetail, retryPayslip } from "../api/client";
import { Spinner } from "../components/Spinner";
import { useWideLayout, XL } from "../history/useWideLayout";
import { PayslipRail } from "../review/PayslipRail";
import { PayslipReview } from "../review/PayslipReview";
import { useUnsavedEdits } from "../review/unsaved/useUnsavedEdits";
import type { BatchItem } from "../upload/UploadBatchContext";
import { useUploadBatch } from "../upload/useUploadBatch";

export const POLL_INTERVAL_MS = 2_000;

type LoadState = "loading" | "ready" | "not_found" | "error";

/** D7: nothing further will change without the user acting. */
function isSettled(payslip: PayslipSummary): boolean {
  if (payslip.status === "review") return payslip.tablesStatus !== "pending";
  return payslip.status === "failed" || payslip.status === "confirmed";
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
 * A session's manual-activation payslip rail and selected review (Task 10 D7).
 * The upload batch and unsaved edits live above this route, so navigation cannot discard either.
 */
export function SessionPage() {
  const { t } = useTranslation();
  const { sessionId = "" } = useParams();
  const { itemsFor, dismiss } = useUploadBatch();
  const xl = useWideLayout(XL);
  const { unsaved } = useUnsavedEdits();
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshKey, setRefreshKey] = useState(0);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const [retryFailed, setRetryFailed] = useState<ReadonlySet<string>>(new Set());
  // The selection lives in the URL, so it survives a reload and the back button (D1).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("payslip");

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

  const selectedIndex = detail?.payslips.findIndex((payslip) => payslip.id === selectedId) ?? -1;
  const selected = selectedIndex === -1 ? null : (detail?.payslips[selectedIndex] ?? null);

  useEffect(() => {
    const first = detail?.payslips[0];
    if (selected === null && first) setSearchParams({ payslip: first.id }, { replace: true });
  }, [detail, selectedId, setSearchParams]);

  if (loadState === "loading") {
    return (
      <div className="mx-auto flex max-w-xl justify-center px-4 py-12">
        <Spinner />
      </div>
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

  const payslips = detail?.payslips ?? [];
  const listed = new Set(payslips.map((payslip) => payslip.id));
  // An uploaded item is represented by its server row once the session read includes it.
  const pending = items.filter(
    (item) => item.state !== "uploaded" || !listed.has(item.payslipId ?? ""),
  );
  const ready = payslips.filter(
    (payslip) => payslip.status === "review" || payslip.status === "confirmed",
  ).length;
  const total = payslips.length + pending.filter((item) => item.state !== "rejected").length;

  return (
    <section
      className={`mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8 ${
        payslips.length === 0 ? "" : "lg:max-w-6xl xl:max-w-7xl"
      }`}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("session.title")}</h1>
        <p role="status" className="text-slate-600">
          {t("session.progress", { ready, total })}
        </p>
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

      {payslips.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-5 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:items-start xl:gap-6">
          <div className="min-w-0 xl:sticky xl:top-20">
            <PayslipRail
              payslips={payslips}
              selectedId={selected?.id ?? null}
              unsaved={unsaved}
              orientation={xl ? "vertical" : "horizontal"}
              onSelect={(id) => {
                if (id !== selectedId) setSearchParams({ payslip: id });
              }}
            />
          </div>
          {selected === null ? null : (
            <div
              role="tabpanel"
              id="payslip-panel"
              tabIndex={0}
              aria-labelledby={`payslip-tab-${selected.id}`}
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="font-semibold break-all">
                {t("session.position", { index: selectedIndex + 1 })} · {selected.originalFilename}
              </h2>
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

      {pending.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {pending.map((item, index) => (
            <Row
              key={item.localId}
              position={payslips.length + index + 1}
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

      <Link to="/" className={linkClass}>
        {t("session.scanMore")}
      </Link>
    </section>
  );
}

interface RowProps {
  readonly position: number;
  readonly name: string;
  readonly detail: string | null;
  readonly icon: ReactNode;
  readonly status: string;
  readonly children?: ReactNode;
}

function Row({ position, name, detail, icon, status, children }: RowProps) {
  const { t } = useTranslation();

  return (
    <li className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {t("session.position", { index: position })}
      </p>
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
