/**
 * A single shimmering placeholder block. Purely decorative — the accessible announcement lives on
 * the container, so every instance is aria-hidden and a screen reader hears one "Loading" rather
 * than a stream of meaningless boxes.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-slate-200 ${className ?? ""}`}
    />
  );
}
