import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

interface ToastContextValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_DURATION_MS = 6_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const timeout = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timeout.current);
    timeout.current = undefined;
    setMessage(null);
  }, []);

  const show = useCallback((nextMessage: string) => {
    window.clearTimeout(timeout.current);
    timeout.current = undefined;
    setPaused(false);
    setMessage(nextMessage);
  }, []);

  useEffect(() => {
    if (message === null || paused) return;
    timeout.current = window.setTimeout(dismiss, TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout.current);
  }, [dismiss, message, paused]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && message !== null) dismiss();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss, message]);

  return (
    <ToastContext value={{ show }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] z-40 max-w-[calc(100vw-2rem)] lg:bottom-4"
      >
        {message ? (
          <div
            className="pointer-events-auto flex animate-[toast-fade_150ms_ease-out] items-center gap-3 rounded-lg border border-green-200 bg-white px-4 py-3 text-green-900 shadow-lg motion-reduce:animate-none"
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <span>{message}</span>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 text-sm font-semibold underline"
            >
              {t("common.dismiss")}
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used within ToastProvider");
  return context;
}
