import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isRenderCancellation, type LoadedPdf, type PdfRenderTask } from "./pdfDocument";

interface PagesProps {
  document: LoadedPdf;
  page: number;
  onChange: (page: number) => void;
}

function PageThumbnail({ document, page }: { document: LoadedPdf; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState<number>();
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let started = false;
    let task: PdfRenderTask | undefined;
    const paint = async () => {
      if (started) return;
      started = true;
      try {
        const size = await document.viewportOf(page);
        if (cancelled) return;
        setRatio(size.width / size.height);
        task = document.render(page, (64 * (window.devicePixelRatio || 1)) / size.width, element);
        await task.completed;
      } catch (error) {
        if (!cancelled && !isRenderCancellation(error))
          console.error("[review] could not paint a page thumbnail", error);
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              void paint();
              observer?.disconnect();
            }
          });
    if (observer) observer.observe(element);
    else void paint();
    return () => {
      cancelled = true;
      observer?.disconnect();
      task?.cancel();
    };
  }, [document, page]);
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="block w-16 max-w-full"
      style={{ aspectRatio: ratio }}
    />
  );
}

function PageButtons({ document, page, onChange }: PagesProps) {
  const { t } = useTranslation();
  return (
    <>
      {Array.from({ length: document.numPages }, (_, index) => index + 1).map((number) => (
        <li key={number}>
          <button
            type="button"
            aria-label={t("review.pageThumbnail", { page: number })}
            aria-current={number === page ? "page" : undefined}
            onClick={() => onChange(number)}
            className={`flex min-h-12 w-full flex-col items-center gap-1 rounded bg-white p-0.5 text-sm ${number === page ? "border-2 border-accent font-semibold" : "border border-slate-300"}`}
          >
            <PageThumbnail document={document} page={number} />
            <span>{number}</span>
          </button>
        </li>
      ))}
    </>
  );
}

function PageRail(props: PagesProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("review.pages")}
      className="max-h-[65dvh] w-[72px] shrink-0 overflow-y-auto p-1"
    >
      <ol className="flex flex-col gap-2">
        <PageButtons {...props} />
      </ol>
    </nav>
  );
}

function PageSheet({ onClose, ...props }: PagesProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    closeButton.current?.focus();
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  function close() {
    dialog.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[80dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={title} className="font-semibold">
          {t("review.choosePage")}
        </h2>
        <button
          ref={closeButton}
          type="button"
          onClick={close}
          aria-label={t("review.closePages")}
          className="grid size-12 place-items-center rounded-lg hover:bg-slate-100"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <ol className="grid grid-cols-3 gap-3">
        <PageButtons
          {...props}
          onChange={(page) => {
            props.onChange(page);
            close();
          }}
        />
      </ol>
    </dialog>
  );
}

/** Pages are sequential parts of the selected payslip, so this is a nav, not nested tabs. */
export function PageNavigator({ document, page, onChange, wide }: PagesProps & { wide: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!open && restoreFocus.current) {
      pill.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);
  if (document.numPages <= 1) return null;
  if (wide) return <PageRail document={document} page={page} onChange={onChange} />;
  return (
    <nav aria-label={t("review.pages")} className="flex items-center justify-center gap-2 text-sm">
      <PagerButton
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        label={t("review.pdfPreviousPage")}
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
      </PagerButton>
      <button
        ref={pill}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="min-h-12 rounded-full border border-slate-300 bg-white px-3 text-slate-700 tabular-nums"
      >
        <span aria-live="polite">
          {t("review.pdfPage", { current: page, total: document.numPages })}
        </span>
      </button>
      <PagerButton
        onClick={() => onChange(page + 1)}
        disabled={page >= document.numPages}
        label={t("review.pdfNextPage")}
      >
        <ChevronRight aria-hidden="true" className="size-5" />
      </PagerButton>
      {open ? (
        <PageSheet
          document={document}
          page={page}
          onChange={onChange}
          onClose={() => {
            restoreFocus.current = true;
            setOpen(false);
          }}
        />
      ) : null}
    </nav>
  );
}

function PagerButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}
