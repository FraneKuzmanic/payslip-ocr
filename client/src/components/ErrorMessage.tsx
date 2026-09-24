import { useTranslation } from "react-i18next";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  const { t } = useTranslation();

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
      <p>{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}
