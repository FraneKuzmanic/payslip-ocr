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
 * The analyzer carrying the Croatian payslip field schema. `estimateFieldSourceAndConfidence`
 * asks CU to return page + bounding quad + confidence per field, including nested table rows.
 */
export function buildAnalyzerDefinition(completionModel: string) {
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
      name: "HrPayslip",
      description: "Polja hrvatskog obračuna plaće",
      fields: Object.fromEntries(Object.entries(PAYSLIP_FIELDS).map(([k, v]) => [k, toCuField(v)])),
    },
  };
}
