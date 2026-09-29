import { useCallback, useState } from "react";
import type { Section } from "./regionSections";

/** Task 15 D9: the scalar sections start open, the three line-item tables closed. */
export const DEFAULT_OPEN: Readonly<Record<Section, boolean>> = {
  employer: true,
  employee: true,
  period: true,
  reconciliation: true,
  payComponents: false,
  obustave: false,
  neoporeziviPrimici: false,
};

export interface OpenSections {
  open: Readonly<Record<Section, boolean>>;
  setOpen(section: Section, open: boolean): void;
  openAll(sections: Iterable<Section>): void;
}

/**
 * Which form sections are open, for this opening of a payslip: every payslip opened starts at
 * `DEFAULT_OPEN`, and toggles last until it is left (Task 15b D8, reversing Task 15 D9's tab
 * storage). The review is keyed by payslip, so the tables pass landing keeps them.
 */
export function useOpenSections(): OpenSections {
  const [open, setState] = useState<Record<Section, boolean>>(() => ({ ...DEFAULT_OPEN }));

  const setOpen = useCallback((section: Section, next: boolean) => {
    setState((current) => (current[section] === next ? current : { ...current, [section]: next }));
  }, []);

  const openAll = useCallback((sections: Iterable<Section>) => {
    const toOpen = [...sections];
    setState((current) =>
      toOpen.every((section) => current[section])
        ? current
        : { ...current, ...Object.fromEntries(toOpen.map((section) => [section, true])) },
    );
  }, []);

  return { open, setOpen, openAll };
}
