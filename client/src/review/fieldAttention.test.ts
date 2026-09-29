import { describe, expect, it } from "vitest";
import { attentionCount, attentionFor, sectionWarnings } from "./fieldAttention";

const none = { warnings: [], lowConfidenceFields: [], ungroundableFields: [] };

describe("attentionFor (Task 09 D18)", () => {
  it("marks nothing without a signal", () => {
    expect(attentionFor("netoPlaca", none)).toBeNull();
  });

  it("lists every warning on the path, and only on that path", () => {
    expect(
      attentionFor("netoPlaca", {
        ...none,
        warnings: [
          { code: "neto_mismatch", field: "netoPlaca" },
          { code: "missing_critical_field", field: "netoPlaca" },
          { code: "dohodak_mismatch", field: "dohodak" },
        ],
      }),
    ).toEqual({ kind: "warning", codes: ["neto_mismatch", "missing_critical_field"] });
  });

  it("prefers a warning over ungroundable and low confidence", () => {
    expect(
      attentionFor("netoPlaca", {
        warnings: [{ code: "neto_mismatch", field: "netoPlaca" }],
        lowConfidenceFields: ["netoPlaca"],
        ungroundableFields: ["netoPlaca"],
      }),
    ).toEqual({ kind: "warning", codes: ["neto_mismatch"] });
  });

  it("prefers ungroundable over low confidence", () => {
    expect(
      attentionFor("obustave.0.iznos", {
        ...none,
        lowConfidenceFields: ["obustave.0.iznos"],
        ungroundableFields: ["obustave.0.iznos"],
      }),
    ).toEqual({ kind: "ungroundable" });
  });

  it("marks low confidence alone", () => {
    expect(attentionFor("period", { ...none, lowConfidenceFields: ["period"] })).toEqual({
      kind: "lowConfidence",
    });
  });
});

describe("sectionWarnings", () => {
  it("returns the warnings on the table itself, not on its cells", () => {
    expect(
      sectionWarnings("payComponents", [
        { code: "pay_components_sum_mismatch", field: "payComponents" },
        { code: "unparseable_amount", field: "payComponents.0.iznos" },
      ]),
    ).toEqual(["pay_components_sum_mismatch"]);
  });
});

describe("attentionCount (Task 15 D9)", () => {
  it("counts the paths with a note, once each, plus the section's own warnings", () => {
    const signals = {
      warnings: [{ code: "missing_critical_field" as const, field: "netoPlaca" }],
      lowConfidenceFields: ["netoPlaca", "brutoPlaca"],
      ungroundableFields: ["dohodak"],
    };

    expect(attentionCount(["netoPlaca", "brutoPlaca", "dohodak", "porezNaDohodak"], signals)).toBe(
      3,
    );
    expect(attentionCount([], signals, ["pay_components_sum_mismatch"])).toBe(1);
    expect(attentionCount(["porezNaDohodak"], none)).toBe(0);
  });
});
