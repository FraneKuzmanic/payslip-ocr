import type { CanonicalPayslipFields } from "@payslip/shared";

/**
 * The seven form sections of PRD §7.7 (Task 08 D4). Ids are English for structure, except the
 * three line-item tables, whose names are Croatian payroll concepts (ROADMAP locked decision 14).
 */
export type Section =
  | "employer"
  | "employee"
  | "period"
  | "reconciliation"
  | "payComponents"
  | "obustave"
  | "neoporeziviPrimici";

/**
 * The outline and legend colour per section. None is amber, the attention colour (PRD §7.7), and
 * each has at least 3:1 contrast against white (WCAG 1.4.11), which a test enforces.
 */
export const SECTION_COLOURS: Record<Section, string> = {
  employer: "#7c3aed",
  employee: "#0f766e",
  period: "#1d4ed8",
  reconciliation: "#be185d",
  payComponents: "#15803d",
  obustave: "#9a3412",
  neoporeziviPrimici: "#a16207",
};

type TableField = "payComponents" | "obustave" | "neoporeziviPrimici";
export type ScalarField = Exclude<keyof CanonicalPayslipFields, TableField>;

/** Typed over the canonical keys, so a new scalar is a type error until it is placed. */
const SCALAR_SECTIONS: Record<ScalarField, Section> = {
  employerName: "employer",
  employerAddress: "employer",
  employerOib: "employer",
  employerIban: "employer",
  employeeName: "employee",
  employeeAddress: "employee",
  employeeOib: "employee",
  employeeIban: "employee",
  period: "period",
  paymentDate: "period",
  ukupnoSati: "period",
  brutoPlaca: "reconciliation",
  doprinosiIzPlace: "reconciliation",
  doprinosMioIStup: "reconciliation",
  doprinosMioIiStup: "reconciliation",
  dohodak: "reconciliation",
  osobniOdbitak: "reconciliation",
  poreznaOsnovica: "reconciliation",
  porezNaDohodak: "reconciliation",
  netoPlaca: "reconciliation",
  neoporeziviPrimiciUkupno: "reconciliation",
  obustaveUkupno: "reconciliation",
  iznosZaIsplatu: "reconciliation",
  doprinosiNaPlacu: "reconciliation",
  ukupanTrosakRada: "reconciliation",
};

// Literal key records, so `t(key)` stays compile-checked (PRD §7.13).
const SCALAR_LABEL_KEYS = {
  employerName: "review.fields.employerName",
  employerAddress: "review.fields.employerAddress",
  employerOib: "review.fields.employerOib",
  employerIban: "review.fields.employerIban",
  employeeName: "review.fields.employeeName",
  employeeAddress: "review.fields.employeeAddress",
  employeeOib: "review.fields.employeeOib",
  employeeIban: "review.fields.employeeIban",
  period: "review.fields.period",
  paymentDate: "review.fields.paymentDate",
  ukupnoSati: "review.fields.ukupnoSati",
  brutoPlaca: "review.fields.brutoPlaca",
  doprinosiIzPlace: "review.fields.doprinosiIzPlace",
  doprinosMioIStup: "review.fields.doprinosMioIStup",
  doprinosMioIiStup: "review.fields.doprinosMioIiStup",
  dohodak: "review.fields.dohodak",
  osobniOdbitak: "review.fields.osobniOdbitak",
  poreznaOsnovica: "review.fields.poreznaOsnovica",
  porezNaDohodak: "review.fields.porezNaDohodak",
  netoPlaca: "review.fields.netoPlaca",
  neoporeziviPrimiciUkupno: "review.fields.neoporeziviPrimiciUkupno",
  obustaveUkupno: "review.fields.obustaveUkupno",
  iznosZaIsplatu: "review.fields.iznosZaIsplatu",
  doprinosiNaPlacu: "review.fields.doprinosiNaPlacu",
  ukupanTrosakRada: "review.fields.ukupanTrosakRada",
} as const satisfies Record<ScalarField, string>;

const COLUMN_LABEL_KEYS = {
  payComponents: {
    naziv: "review.columns.payComponents.naziv",
    sati: "review.columns.payComponents.sati",
    koeficijent: "review.columns.payComponents.koeficijent",
    iznos: "review.columns.payComponents.iznos",
  },
  obustave: {
    naziv: "review.columns.obustave.naziv",
    vjerovnik: "review.columns.obustave.vjerovnik",
    iznos: "review.columns.obustave.iznos",
    ostatakSalda: "review.columns.obustave.ostatakSalda",
    brojRata: "review.columns.obustave.brojRata",
  },
  neoporeziviPrimici: {
    naziv: "review.columns.neoporeziviPrimici.naziv",
    iznos: "review.columns.neoporeziviPrimici.iznos",
  },
} as const;

export const SECTION_LABEL_KEYS = {
  employer: "review.sections.employer",
  employee: "review.sections.employee",
  period: "review.sections.period",
  reconciliation: "review.sections.reconciliation",
  payComponents: "review.sections.payComponents",
  obustave: "review.sections.obustave",
  neoporeziviPrimici: "review.sections.neoporeziviPrimici",
} as const satisfies Record<Section, string>;

type ColumnLabelKey = {
  [T in TableField]: (typeof COLUMN_LABEL_KEYS)[T][keyof (typeof COLUMN_LABEL_KEYS)[T]];
}[TableField];

export type FieldLabel =
  | {
      key: (typeof SCALAR_LABEL_KEYS)[ScalarField];
      section: Section;
      row: null;
    }
  | { key: ColumnLabelKey; section: TableField; row: number };

function isTable(name: string): name is TableField {
  return Object.hasOwn(COLUMN_LABEL_KEYS, name);
}

function isScalar(name: string): name is ScalarField {
  return Object.hasOwn(SCALAR_SECTIONS, name);
}

/** The section a canonical dotted path belongs to, or null for a path this UI does not know. */
export function sectionOf(fieldPath: string): Section | null {
  return fieldLabel(fieldPath)?.section ?? null;
}

/**
 * The label for a canonical dotted path: a scalar's own key, or a cell's column key with its
 * 1-based row (`payComponents.2.iznos` is row 3). Null for a path this UI has no label for, so a
 * caller falls back rather than rendering a raw key.
 */
export function fieldLabel(fieldPath: string): FieldLabel | null {
  const parts = fieldPath.split(".");
  if (parts.length === 1) {
    const [name = ""] = parts;
    return isScalar(name)
      ? { key: SCALAR_LABEL_KEYS[name], section: SCALAR_SECTIONS[name], row: null }
      : null;
  }
  const [table = "", index = "", column = ""] = parts;
  if (parts.length !== 3 || !isTable(table) || !/^\d+$/.test(index)) return null;
  const columns: Record<string, ColumnLabelKey> = COLUMN_LABEL_KEYS[table];
  const key = Object.hasOwn(columns, column) ? columns[column] : undefined;
  return key === undefined ? null : { key, section: table, row: Number(index) + 1 };
}
