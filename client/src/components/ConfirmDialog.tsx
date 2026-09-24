import { useEffect, useId, useRef } from "react";
import { Spinner } from "./Spinner";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Must state the consequence in words — colour and a red button are not the message. */
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A destructive-action confirmation, as a **native `<dialog>` opened with `showModal()`**.
 *
 * The element is used rather than a hand-built overlay on purpose. `showModal()` promotes the
 * dialog into the browser's top layer and makes the rest of the page inert, which is precisely
 * where this project's hand-rolled drawer went wrong before: it marked the app root `inert` while
 * living inside that same root, and opened unfocusable. A top-layer dialog cannot make that
 * mistake, and it brings focus trapping and Escape-to-close with no code of ours.
 *
 * Two WAI-ARIA requirements are ours to satisfy: initial focus goes to the least destructive
 * action, and closing returns focus to whatever opened the dialog.
 *
 * jsdom implements none of this, so the unit tests only prove the wiring. Modality itself is
 * verifiable in a real browser and nowhere else.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      cancelRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      // Escape fires `cancel`; routing it back through onCancel keeps React's state in step with
      // what the browser has already done.
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-900/40"
    >
      <h2 id={titleId} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm text-slate-600">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          ref={cancelRef}
          onClick={onCancel}
          aria-disabled={busy}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 aria-disabled:text-slate-400"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!busy) onConfirm();
          }}
          aria-disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 aria-disabled:bg-red-400"
        >
          {busy ? <Spinner label={false} /> : null}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
