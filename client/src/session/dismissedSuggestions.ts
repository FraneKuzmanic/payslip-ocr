import { useSyncExternalStore } from "react";

/**
 * Merge suggestions the user answered "Not now" (plan 11 D6). Module state, so a dismissal
 * survives route changes in this tab and is lost on reload. Keys are the group's ids joined by `:`
 * in the suggestion's order (Task 15b D7); payslip ids are UUIDs, so a key never matches another
 * session's group. A group that gains a member has a new key, so it is suggested again.
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

export function suggestionKey(ids: readonly string[]): string {
  return ids.join(":");
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
