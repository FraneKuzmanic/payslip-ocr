import { describe, expect, it } from "vitest";
import { analyzerIdFor, buildAnalyzerDefinition, passFields, toCuField } from "./analyzer.js";
import { PAYSLIP_FIELDS } from "./field-schema.js";

describe("the analyzer split (Task 05 D5)", () => {
  const scalars = Object.keys(passFields("scalars"));
  const tables = Object.keys(passFields("tables"));

  it("derives one analyzer id per pass from the family id", () => {
    expect(analyzerIdFor("hrPayslipV1", "scalars")).toBe("hrPayslipV1_scalars");
    expect(analyzerIdFor("hrPayslipV1", "tables")).toBe("hrPayslipV1_tables");
  });

  it("partitions the schema: disjoint, and together exactly the single-pass fields", () => {
    expect(scalars.filter((name) => tables.includes(name))).toEqual([]);
    expect([...scalars, ...tables].toSorted()).toEqual(Object.keys(PAYSLIP_FIELDS).toSorted());
  });

  it("gives the tables pass exactly the three line-item tables", () => {
    expect(tables.toSorted()).toEqual(["neoporeziviPrimici", "obustave", "payComponents"]);
  });

  it("keeps ukupnoSati and currency in the scalars pass", () => {
    expect(scalars).toContain("ukupnoSati");
    expect(scalars).toContain("currency");
  });

  it.each(["scalars", "tables"] as const)(
    "leaves every %s field definition byte-identical to the single-pass schema",
    (pass) => {
      const { fields } = buildAnalyzerDefinition("gpt-4.1", pass).fieldSchema;
      for (const [name, field] of Object.entries(fields)) {
        const def = PAYSLIP_FIELDS[name];
        if (def === undefined) throw new Error(`${name} is not in PAYSLIP_FIELDS`);
        expect(JSON.stringify(field), name).toBe(JSON.stringify(toCuField(def)));
      }
    },
  );
});
