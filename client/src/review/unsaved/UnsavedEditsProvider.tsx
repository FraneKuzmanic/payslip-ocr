import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet } from "react-router";
import { UnsavedEditsContext, type UnsavedEdits } from "./UnsavedEditsContext";

/** Keeps typed values across route changes within the protected branch (Task 10 D1). */
export function UnsavedEditsProvider() {
  const entries = useRef(new Map<string, UnsavedEdits>());
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  const markUnsaved = useCallback((id: string, dirty: boolean) => {
    setUnsaved((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const keep = useCallback(
    (id: string, edits: UnsavedEdits | null) => {
      if (edits === null) entries.current.delete(id);
      else entries.current.set(id, edits);
      markUnsaved(id, edits !== null);
    },
    [markUnsaved],
  );
  const take = useCallback((id: string) => {
    const edits = entries.current.get(id);
    entries.current.delete(id);
    return edits;
  }, []);
  const peek = useCallback((id: string) => entries.current.get(id), []);

  useEffect(() => {
    if (unsaved.size === 0) return;
    // Browsers ignore custom text here; values are deliberately kept only in this tab's memory.
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsaved.size]);

  const value = useMemo(
    () => ({ unsaved, markUnsaved, keep, take, peek }),
    [unsaved, markUnsaved, keep, take, peek],
  );
  return (
    <UnsavedEditsContext.Provider value={value}>
      <Outlet />
    </UnsavedEditsContext.Provider>
  );
}
