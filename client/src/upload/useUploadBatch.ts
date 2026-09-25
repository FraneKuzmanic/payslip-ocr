import { useContext } from "react";
import { UploadBatchContext, type UploadBatchContextValue } from "./UploadBatchContext";

export function useUploadBatch(): UploadBatchContextValue {
  const value = useContext(UploadBatchContext);
  if (value === null) {
    throw new Error("useUploadBatch must be used inside UploadBatchProvider");
  }
  return value;
}
