import { describe, expect, it } from "vitest";
import {
  ANALYZER_ROLES,
  analyzerIdFor,
  buildAnalyzerDefinition,
  roleFields,
  toCuField,
} from "./analyzer.js";
import { PAYSLIP_FIELDS } from "./field-schema.js";

describe("the analyzer roles (Task 05 D5, Task 17 D2–D4)", () => {
  const header = Object.keys(roleFields("header"));
  const reconciliation = Object.keys(roleFields("reconciliation"));
  const tables = Object.keys(roleFields("tables"));

  it("derives one analyzer id per role from the family id", () => {
    expect(analyzerIdFor("hrPayslipV3", "header")).toBe("hrPayslipV3_header");
    expect(analyzerIdFor("hrPayslipV3", "reconciliation")).toBe("hrPayslipV3_reconciliation");
    expect(analyzerIdFor("hrPayslipV3", "tables")).toBe("hrPayslipV3_tables");
  });

  it("partitions the schema: disjoint, and together exactly the schema's fields", () => {
    const all = [...header, ...reconciliation, ...tables];
    expect(new Set(all).size).toBe(all.length);
    expect(all.toSorted()).toEqual(Object.keys(PAYSLIP_FIELDS).toSorted());
  });

  it("gives the header the parties, the period and the payment date", () => {
    expect(header).toEqual([
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
    ]);
  });

  it("gives the reconciliation every other scalar, ukupnoSati included", () => {
    expect(reconciliation).toHaveLength(15);
    expect(reconciliation).toContain("ukupnoSati");
  });

  it("gives the tables role exactly the three line-item tables", () => {
    expect(tables.toSorted()).toEqual(["neoporeziviPrimici", "obustave", "payComponents"]);
  });

  it("asks no role for currency", () => {
    expect([...header, ...reconciliation, ...tables]).not.toContain("currency");
  });

  it.each(ANALYZER_ROLES)("turns formula detection off for %s", (role) => {
    const { config } = buildAnalyzerDefinition("gpt-4.1", role);
    expect(config).toMatchObject({ enableFormula: false });
    // The service drops this key, so the drift check could never match it.
    expect(config).not.toHaveProperty("enableBarcode");
  });

  it("names both scalar parts' schema as the measured halves were named", () => {
    expect(buildAnalyzerDefinition("gpt-4.1", "header").fieldSchema.name).toBe("HrPayslipScalars");
    expect(buildAnalyzerDefinition("gpt-4.1", "reconciliation").fieldSchema.name).toBe(
      "HrPayslipScalars",
    );
    expect(buildAnalyzerDefinition("gpt-4.1", "tables").fieldSchema.name).toBe("HrPayslipTables");
  });

  it.each(ANALYZER_ROLES)(
    "leaves every %s field definition byte-identical to the schema",
    (role) => {
      const { fields } = buildAnalyzerDefinition("gpt-4.1", role).fieldSchema;
      for (const [name, field] of Object.entries(fields)) {
        const def = PAYSLIP_FIELDS[name];
        if (def === undefined) throw new Error(`${name} is not in PAYSLIP_FIELDS`);
        expect(JSON.stringify(field), name).toBe(JSON.stringify(toCuField(def)));
      }
    },
  );
});
