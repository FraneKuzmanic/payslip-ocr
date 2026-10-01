import { PAYSLIP_FIELDS, SHARED_RULES, type FieldDef } from "./field-schema.js";

/** The analyzer's top-level description. Exported so the provisioning drift check compares it. */
export const ANALYZER_DESCRIPTION = `Hrvatski obračun plaće (Obrazac IP1).\n\n${SHARED_RULES}`;

/** Our FieldDef tree -> CU fieldSchema. */
export function toCuField(def: FieldDef): Record<string, unknown> {
  if (def.type === "array" && def.items) {
    return {
      type: "array",
      method: "extract",
      description: def.description,
      items: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(def.items).map(([k, v]) => [
            k,
            { type: "string", method: "extract", description: v.description },
          ]),
        ),
      },
    };
  }
  return { type: "string", method: "extract", description: def.description };
}

/** The scalars pass runs as two analyses at once (Task 17 D1, D4). */
export const SCALAR_PARTS = ["header", "reconciliation"] as const;
export type ScalarPart = (typeof SCALAR_PARTS)[number];
/** What one analyzer extracts: a part of the scalars pass, or the tables pass. */
export type AnalyzerRole = ScalarPart | "tables";
export const ANALYZER_ROLES: readonly AnalyzerRole[] = [...SCALAR_PARTS, "tables"];

/** The parties, the period and the payment date: the top of the form (Task 17 D4). */
const HEADER_FIELDS: readonly string[] = [
  "employerName",
  "employerAddress",
  "employerOib",
  "employerIban",
  "employeeName",
  "employeeAddress",
  "employeeOib",
  "employeeIban",
  "period",
  "paymentDate",
];

/**
 * One analyzer per role (Task 05 D5, Task 17 D2), derived from the configured family ID:
 * `hrPayslipV3` gives `hrPayslipV3_header`, `hrPayslipV3_reconciliation` and `hrPayslipV3_tables`.
 * An underscore, not a period, so the `:analyzeBinary` path segment stays unambiguous.
 */
export function analyzerIdFor(familyId: string, role: AnalyzerRole): string {
  return `${familyId}_${role}`;
}

/**
 * The role's share of `PAYSLIP_FIELDS` (Task 17 D4): the three `array` fields for `tables`, the
 * ten `HEADER_FIELDS` for `header`, and every other scalar for `reconciliation` (including
 * `ukupnoSati`, printed on the bruto line). Descriptions are untouched, so a re-score isolates the
 * effect of the split.
 */
export function roleFields(role: AnalyzerRole): Record<string, FieldDef> {
  return Object.fromEntries(
    Object.entries(PAYSLIP_FIELDS).filter(([name, def]) => {
      if (def.type === "array") return role === "tables";
      return role === (HEADER_FIELDS.includes(name) ? "header" : "reconciliation");
    }),
  );
}

/**
 * The analyzer carrying one role's share of the Croatian payslip field schema.
 * `estimateFieldSourceAndConfidence` asks CU to return page + bounding quad + confidence per
 * field, including nested table rows.
 */
export function buildAnalyzerDefinition(completionModel: string, role: AnalyzerRole) {
  return {
    baseAnalyzerId: "prebuilt-document",
    description: ANALYZER_DESCRIPTION,
    // Must name the deployment explicitly: resource-level defaults alone are not enough,
    // the analyzer build resolves models.completion from its own definition.
    models: { completion: completionModel },
    config: {
      returnDetails: true,
      estimateFieldSourceAndConfidence: true,
      enableLayout: true,
      enableOcr: true,
      // Defaults to true; a payslip carries no formulas. As measured (Task 17 D3). The measured
      // analyzers also sent `enableBarcode: false`, which this API version drops: it is not in the
      // deployed config and barcodes still come back, so it is not sent.
      enableFormula: false,
    },
    fieldSchema: {
      // Both scalar parts keep the name the measured halves carried (Task 17 D3).
      name: role === "tables" ? "HrPayslipTables" : "HrPayslipScalars",
      description: "Polja hrvatskog obračuna plaće",
      fields: Object.fromEntries(
        Object.entries(roleFields(role)).map(([k, v]) => [k, toCuField(v)]),
      ),
    },
  };
}
