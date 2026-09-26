import { useSyncExternalStore } from "react";

/**
 * Merge suggestions the user answered "Not now" (plan 11 D6). Module state, so a dismissal
 * survives route changes in this tab and is lost on reload. Keys are `${a}:${b}` in the
 * suggestion's order; payslip ids are UUIDs, so a key never matches another session's pair.
 */
let dismissed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ReadonlySet<string> {
  return dismissed;
}

export function suggestionKey([a, b]: readonly [string, string]): string {
  return `${a}:${b}`;
}

export function useDismissedSuggestions(): {
  dismissed: ReadonlySet<string>;
  dismiss: (key: string) => void;
} {
  return { dismissed: useSyncExternalStore(subscribe, snapshot), dismiss };
}

function dismiss(key: string): void {
  if (dismissed.has(key)) return;
  dismissed = new Set([...dismissed, key]);
  for (const listener of listeners) listener();
}

/** Tests only: module state outlives a test. */
export function resetDismissedSuggestions(): void {
  dismissed = new Set();
  for (const listener of listeners) listener();
}
