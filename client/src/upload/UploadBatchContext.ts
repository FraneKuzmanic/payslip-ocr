import { createContext } from "react";
import type { UploadErrorCode } from "@payslip/shared";

/** `network` covers every failure without a known upload code, including a 401 that stops a batch. */
export type BatchErrorCode = UploadErrorCode | "network";

export interface BatchItem {
  readonly localId: string;
  readonly name: string;
  readonly state: "waiting" | "uploading" | "uploaded" | "rejected";
  readonly payslipId?: string;
  readonly errorCode?: BatchErrorCode;
}

/**
 * `ok` once the first payslip exists; the rest keep uploading. Otherwise nothing was created:
 * `session` when the session itself could not be made, else each file's code by its index.
 */
export type StartBatchResult =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly errors: ReadonlyMap<number, BatchErrorCode> | "session" };

export interface UploadBatchContextValue {
  startBatch(files: readonly File[]): Promise<StartBatchResult>;
  /** The batch items for a session, in tray order; empty for a session this tab did not upload. */
  itemsFor(sessionId: string): readonly BatchItem[];
  dismiss(sessionId: string, localId: string): void;
}

export const UploadBatchContext = createContext<UploadBatchContextValue | null>(null);
