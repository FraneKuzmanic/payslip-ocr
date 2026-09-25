import { AlertCircle, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import {
  isRetryableFailure,
  type PayslipSummary,
  type SessionDetailResponse,
} from "@payslip/shared";
import { ApiError, getSessionDetail, retryPayslip } from "../api/client";
import { Spinner } from "../components/Spinner";
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

/**
 * The landing route after upload (Task 07 D2): every payslip of one session with its live status.
 * Deliberately plain; Task 10 replaces the list with the chip rail and Task 09 adds the form.
 */
export function SessionPage() {
  const { t } = useTranslation();
  const { sessionId = "" } = useParams();
  const { itemsFor, dismiss } = useUploadBatch();
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshKey, setRefreshKey] = useState(0);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const [retryFailed, setRetryFailed] = useState<ReadonlySet<string>>(new Set());

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
      // The retry button is gone once the row shows processing; keep focus on the row rather than
      // letting it fall to the page body.
      document.getElementById(rowId(id))?.focus();
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
    <section className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8">
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

      <ol className="flex flex-col gap-3">
        {payslips.map((payslip, index) => (
          <Row
            key={payslip.id}
            id={rowId(payslip.id)}
            position={index + 1}
            name={payslip.originalFilename}
            detail={
              payslip.employeeName || payslip.period
                ? [payslip.employeeName, payslip.period].filter(Boolean).join(" · ")
                : null
            }
            icon={statusIcon(payslip)}
            status={t(`payslipStatus.${payslip.status}`)}
          >
            {payslip.status === "review" ? (
              <p className="text-slate-600">{t(`tablesStatus.${payslip.tablesStatus}`)}</p>
            ) : null}
            {payslip.status === "failed" && payslip.failureReason ? (
              <p className="text-red-800">{t(`failureReason.${payslip.failureReason}`)}</p>
            ) : null}
            {retryFailed.has(payslip.id) ? (
              <p role="alert" className="text-red-800">
                {t("session.retryError")}
              </p>
            ) : null}
            {payslip.status === "failed" &&
            payslip.failureReason &&
            isRetryableFailure(payslip.failureReason) ? (
              <button
                type="button"
                onClick={() => void retry(payslip.id)}
                aria-disabled={retrying.has(payslip.id)}
                className="flex min-h-12 items-center gap-2 self-start rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
              >
                {retrying.has(payslip.id) ? <Spinner label={false} className="size-5" /> : null}
                {t("session.retry")}
              </button>
            ) : null}
          </Row>
        ))}
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

      <Link to="/" className={linkClass}>
        {t("session.scanMore")}
      </Link>
    </section>
  );
}

interface RowProps {
  readonly id?: string;
  readonly position: number;
  readonly name: string;
  readonly detail: string | null;
  readonly icon: ReactNode;
  readonly status: string;
  readonly children?: ReactNode;
}

function Row({ id, position, name, detail, icon, status, children }: RowProps) {
  const { t } = useTranslation();

  return (
    <li
      id={id}
      tabIndex={id === undefined ? undefined : -1}
      className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 text-sm"
    >
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

function statusIcon(payslip: PayslipSummary): ReactNode {
  switch (payslip.status) {
    case "processing":
      return <Loader2 aria-hidden="true" className={`${iconClass} animate-spin text-slate-600`} />;
    case "failed":
      return <AlertCircle aria-hidden="true" className={`${iconClass} text-red-700`} />;
    default:
      return <CheckCircle2 aria-hidden="true" className={`${iconClass} text-emerald-700`} />;
  }
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

function rowId(payslipId: string): string {
  return `payslip-row-${payslipId}`;
}

function without(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}
