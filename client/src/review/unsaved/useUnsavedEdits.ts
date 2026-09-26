import { useContext } from "react";
import { UnsavedEditsContext, type UnsavedEditsContextValue } from "./UnsavedEditsContext";

export function useUnsavedEdits(): UnsavedEditsContextValue {
  const value = useContext(UnsavedEditsContext);
  if (value === null) throw new Error("useUnsavedEdits must be used inside UnsavedEditsProvider");
  return value;
}
