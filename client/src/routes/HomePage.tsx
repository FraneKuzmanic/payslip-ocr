import { Camera, FileText, FileUp, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { MAX_PAYSLIPS_PER_SESSION } from "@payslip/shared";
import {
  CAMERA_ACCEPT,
  FILE_ACCEPT,
  type QualityWarning,
  type SourceFileError,
  type SourceFileKind,
  analyzeSourceImage,
  classifySourceFile,
} from "../capture/sourceFile";
import { downscaleSourceImage } from "../capture/downscale";
import { useCameraCapture } from "../capture/useCameraCapture";
import { Spinner } from "../components/Spinner";
import type { BatchErrorCode } from "../upload/UploadBatchContext";
import { useUploadBatch } from "../upload/useUploadBatch";

interface TrayItem {
  readonly localId: string;
  /** The name the user chose; a downscaled upload is renamed to `.jpg`. */
  readonly name: string;
  readonly kind: SourceFileKind;
  /** Set once prepared: the exact bytes that upload, and that the preview is built from. */
  readonly file?: File;
  readonly previewUrl?: string;
  /** D10: this browser cannot decode the image (HEIC outside Safari). The original uploads. */
  readonly previewUnavailable: boolean;
  readonly warnings: readonly QualityWarning[];
  readonly errorCode?: BatchErrorCode;
}

interface Notice {
  readonly overCap: number;
  readonly refused: readonly { readonly name: string; readonly code: SourceFileError }[];
}

const NO_NOTICE: Notice = { overCap: 0, refused: [] };
const CAP_NOTE_ID = "capture-cap";

const primaryPicker =
  "flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-ring has-aria-disabled:cursor-not-allowed has-aria-disabled:bg-slate-400";
const secondaryPicker =
  "flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-ring has-aria-disabled:cursor-not-allowed has-aria-disabled:text-slate-400";

/** In the UI language, not the browser's: a Croatian page shows "1,5 MB". */
function sizeInMegabytes(size: number, language: string | undefined): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(size / 1024 / 1024);
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const cameraCapture = useCameraCapture();
  const { startBatch } = useUploadBatch();
  const [tray, setTray] = useState<readonly TrayItem[]>([]);
  const [notice, setNotice] = useState<Notice>(NO_NOTICE);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // D1: one file is prepared at a time. Decoding ten 12 MP photos at once can exhaust a phone.
  const preparing = useRef<Promise<void>>(Promise.resolve());
  // An item removed while it is still being prepared must not come back as a ghost.
  const removed = useRef(new Set<string>());
  const previewUrls = useRef(new Map<string, string>());
  // A file still being prepared at unmount must not create a URL the cleanup can no longer revoke.
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    const urls = previewUrls.current;
    return () => {
      unmounted.current = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, []);

  function updateItem(localId: string, change: Partial<TrayItem>) {
    setTray((items) =>
      items.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
    );
  }

  async function prepare(localId: string, file: File, kind: SourceFileKind) {
    if (removed.current.has(localId)) return;
    if (kind === "pdf") {
      updateItem(localId, { file });
      return;
    }

    let warnings: QualityWarning[];
    try {
      warnings = (await analyzeSourceImage(file)).warnings;
    } catch (caught) {
      // `analyzeSourceImage` only throws PreviewUnavailableError. PRD §4.1 accepts HEIC, so the
      // original is sent rather than refused; Content Understanding decodes it server-side.
      console.warn(`[capture] no preview for ${file.name}; the original file will upload`, caught);
      if (!removed.current.has(localId)) {
        updateItem(localId, { file, previewUnavailable: true });
      }
      return;
    }
    if (removed.current.has(localId)) return;

    const uploadFile = await downscaleSourceImage(file);
    if (removed.current.has(localId) || unmounted.current) return;

    const previewUrl = URL.createObjectURL(uploadFile);
    previewUrls.current.set(localId, previewUrl);
    updateItem(localId, { file: uploadFile, previewUrl, warnings });
  }

  function addFiles(files: readonly File[]) {
    if (uploading || files.length === 0) return;

    const refused: { name: string; code: SourceFileError }[] = [];
    const accepted: { file: File; kind: SourceFileKind }[] = [];
    for (const file of files) {
      const result = classifySourceFile(file);
      if (result.ok) accepted.push({ file, kind: result.kind });
      else refused.push({ name: file.name, code: result.error });
    }

    // D4: keep the first ten and say how many were left out, never drop them silently.
    const room = Math.max(0, MAX_PAYSLIPS_PER_SESSION - tray.length);
    const added = accepted.slice(0, room).map(({ file, kind }) => ({
      file,
      item: {
        localId: crypto.randomUUID(),
        name: file.name,
        kind,
        previewUnavailable: false,
        warnings: [],
      } satisfies TrayItem,
    }));

    setNotice({ overCap: accepted.length - added.length, refused });
    setError(null);
    setTray((items) => [...items, ...added.map(({ item }) => item)]);
    for (const { file, item } of added) {
      preparing.current = preparing.current.then(() => prepare(item.localId, file, item.kind));
    }
  }

  function remove(localId: string) {
    if (uploading) return;
    removed.current.add(localId);
    const url = previewUrls.current.get(localId);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(localId);
    setTray((items) => items.filter((item) => item.localId !== localId));
    setNotice(NO_NOTICE);
    setError(null);
  }

  const full = tray.length >= MAX_PAYSLIPS_PER_SESSION;
  const settled = tray.every((item) => item.file !== undefined);

  async function upload() {
    if (uploading || !settled || tray.length === 0) return;

    setUploading(true);
    setError(null);
    setTray((items) => items.map((item) => ({ ...item, errorCode: undefined })));
    const result = await startBatch(tray.map((item) => item.file!));
    if (result.ok) {
      // Preview URLs are revoked by the unmount cleanup, after the images have gone.
      navigate(`/sessions/${result.sessionId}`);
      return;
    }

    setUploading(false);
    if (result.errors === "session") {
      setError(t("capture.sessionError"));
      return;
    }
    const errors = result.errors;
    setTray((items) => items.map((item, index) => ({ ...item, errorCode: errors.get(index) })));
    setError(t("capture.allRejected"));
  }

  // D4: at the cap the pickers stay focusable and say why they do nothing, rather than vanishing
  // from the tab order as `disabled` would.
  function blockWhenFull(event: MouseEvent<HTMLInputElement>) {
    if (full || uploading) event.preventDefault();
  }

  function pickerInput(camera: boolean) {
    return (
      <input
        type="file"
        accept={camera ? CAMERA_ACCEPT : FILE_ACCEPT}
        // `capture` opens a single-shot camera, and `multiple` beside it is ignored or unreliable
        // on phones: each press adds one photo (D1).
        capture={camera ? "environment" : undefined}
        multiple={!camera}
        className="sr-only"
        aria-disabled={full || uploading}
        aria-describedby={full ? CAP_NOTE_ID : undefined}
        onClick={blockWhenFull}
        onChange={(event) => {
          addFiles(Array.from(event.currentTarget.files ?? []));
          // Choosing the same file again must still fire `change`.
          event.currentTarget.value = "";
        }}
      />
    );
  }

  const count = tray.length;
  const busy = uploading || !settled;

  return (
    // min-h rather than h, plus justify-center: because the height is a *minimum*, a long tray
    // grows the container instead of being centred and clipped off the top of the screen. The
    // subtractions are the header and the mobile tab bar.
    <div className="flex min-h-[calc(100svh-3.5rem-4rem)] flex-col justify-center px-4 py-8 lg:min-h-[calc(100svh-4rem)]">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
          <p className="max-w-prose text-slate-600">{t("home.subtitle")}</p>
          <p className="max-w-prose text-slate-600">{t("capture.guidance")}</p>
        </div>

        <div className="flex flex-col gap-3">
          {/* focus-within, not focus: the focusable input is sr-only and invisible, so a ring
              painted on it lands nowhere. The label is the element the user is looking at.
              Without this the capture controls are a live WCAG 2.4.7 failure. */}
          {cameraCapture ? (
            <label className={primaryPicker}>
              <Camera aria-hidden="true" className="size-5" />
              {count > 0 ? t("capture.scanAnother") : t("capture.scan")}
              {pickerInput(true)}
            </label>
          ) : null}
          {/* Without a camera-capable pointer this is the only picker, and it is promoted to the
              primary action — two buttons that open the same dialog is not a choice. */}
          <label className={cameraCapture ? secondaryPicker : primaryPicker}>
            <FileUp aria-hidden="true" className="size-5" />
            {t("capture.chooseFiles")}
            {pickerInput(false)}
          </label>
          {full ? (
            <p id={CAP_NOTE_ID} className="text-sm text-slate-600">
              {t("capture.cap")}
            </p>
          ) : null}
        </div>

        {notice.overCap > 0 || notice.refused.length > 0 ? (
          <div
            aria-live="polite"
            className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950"
          >
            {notice.overCap > 0 ? <p>{t("capture.overCap", { count: notice.overCap })}</p> : null}
            {notice.refused.map(({ name, code }, index) => (
              <p key={`${name}-${index}`}>
                {t("capture.rejectedFile", { name, reason: t(`upload.${code}`) })}
              </p>
            ))}
          </div>
        ) : null}

        {count > 0 ? (
          <ul aria-label={t("capture.trayLabel")} className="flex flex-col gap-3">
            {tray.map((item) => (
              <li
                key={item.localId}
                className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">
                  {item.file === undefined ? (
                    <Spinner label={false} className="size-5" />
                  ) : item.previewUrl ? (
                    <img
                      src={item.previewUrl}
                      alt={t("capture.imagePreview", { name: item.name })}
                      className="size-full object-contain"
                    />
                  ) : (
                    <FileText aria-hidden="true" className="size-8 text-slate-600" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <p className="font-medium break-all">{item.name}</p>
                  {item.file === undefined ? (
                    <p className="text-slate-600">{t("capture.processing", { name: item.name })}</p>
                  ) : (
                    <p className="text-slate-600">
                      {item.kind === "pdf" ? `${t("capture.documentPreview")} · ` : null}
                      {t("capture.fileSize", {
                        size: sizeInMegabytes(item.file.size, i18n.resolvedLanguage),
                      })}
                    </p>
                  )}
                  {item.previewUnavailable ? (
                    <p className="text-slate-600">{t("capture.previewUnavailable")}</p>
                  ) : null}
                  {item.warnings.map((warning) => (
                    <p key={warning} className="text-amber-900">
                      {warning === "low_resolution"
                        ? t("capture.lowResolution")
                        : t("capture.possibleBlur")}
                    </p>
                  ))}
                  {item.errorCode ? (
                    <p className="text-red-800">
                      {item.errorCode === "network"
                        ? t("session.uploadNetworkError")
                        : t(`upload.${item.errorCode}`)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.localId)}
                  aria-disabled={uploading}
                  aria-label={t("capture.remove", { name: item.name })}
                  className="grid min-h-12 min-w-12 shrink-0 place-items-center self-start rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 aria-disabled:text-slate-300"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {count > 0 ? (
          <>
            {/* aria-disabled, not disabled: the pressed button keeps focus and stays in the tab
                order while the batch starts (Task 07 DoD). */}
            <button
              type="button"
              onClick={() => void upload()}
              aria-disabled={busy}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover aria-disabled:bg-slate-400"
            >
              {uploading ? (
                <Spinner label={false} className="size-5" />
              ) : (
                <FileUp aria-hidden="true" className="size-5" />
              )}
              {uploading ? t("capture.uploading") : t("capture.upload", { count })}
            </button>
            {/* "Uploading…" on the button is a changed accessible name, which screen readers
                re-announce unreliably; this is the dependable channel. */}
            <p role="status" className="sr-only">
              {uploading ? t("capture.uploadingStatus") : ""}
            </p>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
