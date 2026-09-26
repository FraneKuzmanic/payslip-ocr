import { createContext } from "react";
import type { ReviewFormValues } from "../reviewForm";

export interface UnsavedEdits {
  readonly values: ReviewFormValues;
  readonly dirtyKeys: readonly (keyof ReviewFormValues)[];
}

export interface UnsavedEditsContextValue {
  readonly unsaved: ReadonlySet<string>;
  markUnsaved(payslipId: string, dirty: boolean): void;
  keep(payslipId: string, edits: UnsavedEdits | null): void;
  take(payslipId: string): UnsavedEdits | undefined;
  peek(payslipId: string): UnsavedEdits | undefined;
}

export const UnsavedEditsContext = createContext<UnsavedEditsContextValue | null>(null);
