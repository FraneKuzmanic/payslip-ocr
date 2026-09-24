import { useTranslation } from "react-i18next";

interface SpinnerProps {
  label?: boolean;
  /** Size utility for the glyph, so it can match the icon it replaces inside a button. */
  className?: string;
}

export function Spinner({ label = true, className = "size-4" }: SpinnerProps) {
  const { t } = useTranslation();

  // `inline-block` is load-bearing: a bare <span> is `display: inline`, and width/height do not
  // apply to inline boxes. Without it the glyph only sizes correctly when its parent happens to be
  // a flex container, and collapses into a small broken blob anywhere else.
  // The border is drawn in `currentColor` so one spinner works on the accent button (white text)
  // and on the outlined button (slate text) without a variant prop.
  const indicator = (
    <span
      aria-hidden="true"
      className={`inline-block ${className} animate-spin rounded-full border-2 border-current/30 border-t-current`}
    />
  );

  if (!label) return indicator;

  return (
    <span role="status" className="inline-flex items-center gap-2 text-slate-600">
      {indicator}
      {t("common.loading")}
    </span>
  );
}
