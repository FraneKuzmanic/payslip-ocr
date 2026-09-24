import { describe, expect, it } from "vitest";
import { WARNING_CODES, payslipWarningSchema, warningCodeSchema } from "./warnings.js";

describe("warning taxonomy", () => {
  it("is exactly the nine codes of PRD §7.9, in order", () => {
    expect(WARNING_CODES).toEqual([
      "missing_critical_field",
      "unparseable_amount",
      "unparseable_date",
      "oib_checksum_failed",
      "dohodak_mismatch",
      "porezna_osnovica_mismatch",
      "neto_mismatch",
      "isplata_mismatch",
      "pay_components_sum_mismatch",
    ]);
  });

  it("rejects an unknown code", () => {
    expect(warningCodeSchema.safeParse("vat_arithmetic_mismatch").success).toBe(false);
  });
});

describe("payslipWarningSchema", () => {
  it("accepts a code with a dotted field path, and without one", () => {
    expect(
      payslipWarningSchema.safeParse({ code: "neto_mismatch", field: "payComponents.2.iznos" })
        .success,
    ).toBe(true);
    expect(payslipWarningSchema.safeParse({ code: "dohodak_mismatch" }).success).toBe(true);
  });

  it("rejects an unknown key, because prose never travels with a warning", () => {
    const result = payslipWarningSchema.safeParse({ code: "neto_mismatch", message: "Check it" });
    expect(result.success).toBe(false);
  });
});
