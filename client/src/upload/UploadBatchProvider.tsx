import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet } from "react-router";
import { uploadErrorCodeSchema } from "@payslip/shared";
import { ApiError, createSession, uploadPayslip } from "../api/client";
import { supabase } from "../lib/supabase";
import {
  UploadBatchContext,
  type BatchErrorCode,
  type BatchItem,
  type StartBatchResult,
  type UploadBatchContextValue,
} from "./UploadBatchContext";

const NO_ITEMS: readonly BatchItem[] = [];

/**
 * Owns every upload batch (Task 07 D3). It is a layout route above both the capture page and the
 * session page, because the capture page unmounts when it navigates at the first `201` while the
 * remaining files are still uploading.
 */
export function UploadBatchProvider() {
  const [batches, setBatches] = useState<ReadonlyMap<string, readonly BatchItem[]>>(new Map());
  // Held only until each file's POST settles, then dropped: a batch can be ten 10 MB files.
  const files = useRef(new Map<string, File>());

  const updateItem = useCallback(
    (sessionId: string, localId: string, change: Partial<BatchItem>) => {
      setBatches((previous) => {
        const items = previous.get(sessionId);
        if (items === undefined) return previous;
        return new Map(previous).set(
          sessionId,
          items.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
        );
      });
    },
    [],
  );

  const startBatch = useCallback(
    async (selected: readonly File[]): Promise<StartBatchResult> => {
      const started = performance.now();

      // D5: the background extraction writes use the token each upload carries, so a token near
      // expiry would fail them. A refresh gives the whole batch the full token lifetime. If the
      // session is really gone, the next request's 401 handling takes over.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.error("[upload] could not refresh the auth session before a batch", refreshError);
      }

      let sessionId: string;
      try {
        sessionId = (await createSession()).id;
      } catch (caught) {
        console.error("[upload] could not create a session", caught);
        return { ok: false, errors: "session" };
      }

      const items: BatchItem[] = selected.map((file) => ({
        localId: crypto.randomUUID(),
        name: file.name,
        state: "waiting",
      }));
      items.forEach((item, index) => files.current.set(item.localId, selected[index]!));
      setBatches((previous) => new Map(previous).set(sessionId, items));

      return await new Promise<StartBatchResult>((resolve) => {
        void (async () => {
          const errors = new Map<number, BatchErrorCode>();
          let resolved = false;

          // Sequential, in tray order, so server `created_at` order is selection order (D3).
          for (const [index, item] of items.entries()) {
            const file = files.current.get(item.localId)!;
            updateItem(sessionId, item.localId, { state: "uploading" });
            try {
              const created = await uploadPayslip(sessionId, file);
              updateItem(sessionId, item.localId, { state: "uploaded", payslipId: created.id });
              if (!resolved) {
                resolved = true;
                // D12: the evidence for the "review route in under 3 s" target.
                console.info("[upload] first payslip created", {
                  ms: Math.round(performance.now() - started),
                });
                resolve({ ok: true, sessionId });
              }
            } catch (caught) {
              const code = toBatchErrorCode(caught);
              errors.set(index, code);
              updateItem(sessionId, item.localId, { state: "rejected", errorCode: code });

              // `request()` has already signed out and ProtectedRoute redirects: stop here.
              if (caught instanceof ApiError && caught.status === 401) {
                for (const [restIndex, rest] of items.entries()) {
                  if (restIndex <= index) continue;
                  errors.set(restIndex, "network");
                  updateItem(sessionId, rest.localId, { state: "rejected", errorCode: "network" });
                  files.current.delete(rest.localId);
                }
                break;
              }
            } finally {
              files.current.delete(item.localId);
            }
          }

          if (!resolved) resolve({ ok: false, errors });
        })();
      });
    },
    [updateItem],
  );

  const itemsFor = useCallback(
    (sessionId: string) => batches.get(sessionId) ?? NO_ITEMS,
    [batches],
  );

  const dismiss = useCallback((sessionId: string, localId: string) => {
    setBatches((previous) => {
      const items = previous.get(sessionId);
      if (items === undefined) return previous;
      return new Map(previous).set(
        sessionId,
        items.filter((item) => item.localId !== localId),
      );
    });
  }, []);

  const unsent = useMemo(
    () =>
      [...batches.values()].some((items) =>
        items.some((item) => item.state === "waiting" || item.state === "uploading"),
      ),
    [batches],
  );

  // D6: the browser's own "Leave site?" dialog while files are unsent. Registered only then,
  // because a `beforeunload` listener keeps the page out of the back/forward cache.
  useEffect(() => {
    if (!unsent) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsent]);

  const value = useMemo<UploadBatchContextValue>(
    () => ({ startBatch, itemsFor, dismiss }),
    [startBatch, itemsFor, dismiss],
  );

  return (
    <UploadBatchContext.Provider value={value}>
      <Outlet />
    </UploadBatchContext.Provider>
  );
}

function toBatchErrorCode(caught: unknown): BatchErrorCode {
  if (caught instanceof ApiError && caught.code) {
    const code = uploadErrorCodeSchema.safeParse(caught.code);
    if (code.success) return code.data;
  }
  console.error("[upload] upload failed for an unrecognised reason", caught);
  return "network";
}
