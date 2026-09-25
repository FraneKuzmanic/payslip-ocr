import type { ExtractionPass } from "../types.js";
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

/**
 * One analyzer per extraction pass (Task 05 D5), derived from the configured family ID:
 * `hrPayslipV1` gives `hrPayslipV1_scalars` and `hrPayslipV1_tables`. An underscore, not a period,
 * so the `:analyzeBinary` path segment stays unambiguous.
 */
export function analyzerIdFor(familyId: string, pass: ExtractionPass): string {
  return `${familyId}_${pass}`;
}

/**
 * The pass's share of `PAYSLIP_FIELDS`: the three `array` fields for `tables`, every other field
 * for `scalars` (including `ukupnoSati`, printed on the bruto line, and `currency`, which the
 * mapper ignores). Descriptions are untouched, so a re-score isolates the effect of the split.
 */
export function passFields(pass: ExtractionPass): Record<string, FieldDef> {
  return Object.fromEntries(
    Object.entries(PAYSLIP_FIELDS).filter(
      ([, def]) => (def.type === "array") === (pass === "tables"),
    ),
  );
}

/**
 * The analyzer carrying one pass's share of the Croatian payslip field schema.
 * `estimateFieldSourceAndConfidence` asks CU to return page + bounding quad + confidence per
 * field, including nested table rows.
 */
export function buildAnalyzerDefinition(completionModel: string, pass: ExtractionPass) {
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
    },
    fieldSchema: {
      name: pass === "scalars" ? "HrPayslipScalars" : "HrPayslipTables",
      description: "Polja hrvatskog obračuna plaće",
      fields: Object.fromEntries(
        Object.entries(passFields(pass)).map(([k, v]) => [k, toCuField(v)]),
      ),
    },
  };
}
