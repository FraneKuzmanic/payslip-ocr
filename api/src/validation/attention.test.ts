import { describe, expect, it } from "vitest";
import { lowConfidenceFields } from "./attention.js";

const pass = (
  fields: Record<string, { confidence: number | null }>,
  ungroundableFields: string[] = [],
) => ({ fields, ungroundableFields });

describe("lowConfidenceFields", () => {
  it("flags a confidence below 0.5 and not one at 0.5", () => {
    expect(
      lowConfidenceFields([
        pass({ netoPlaca: { confidence: 0.49 }, dohodak: { confidence: 0.5 } }),
      ]),
    ).toEqual(["netoPlaca"]);
  });

  it("does not flag an unknown confidence", () => {
    expect(lowConfidenceFields([pass({ brutoPlaca: { confidence: null } })])).toEqual([]);
  });

  it("keeps pass order, scalars first", () => {
    expect(
      lowConfidenceFields([
        pass({ brutoPlaca: { confidence: 0.1 }, dohodak: { confidence: 0.2 } }),
        pass({ "payComponents.0.iznos": { confidence: 0.3 } }),
      ]),
    ).toEqual(["brutoPlaca", "dohodak", "payComponents.0.iznos"]);
  });

  it("lists a path once when two passes both flag it", () => {
    expect(
      lowConfidenceFields([
        pass({ netoPlaca: { confidence: 0.1 } }),
        pass({ netoPlaca: { confidence: 0.2 } }),
      ]),
    ).toEqual(["netoPlaca"]);
  });

  describe("grounding-gated paths (Task 09 D7)", () => {
    it("does not flag a low-confidence paymentDate that was grounded", () => {
      expect(lowConfidenceFields([pass({ paymentDate: { confidence: 0.3 } })])).toEqual([]);
    });

    it("flags a low-confidence paymentDate that the same pass could not ground", () => {
      expect(
        lowConfidenceFields([pass({ paymentDate: { confidence: 0.3 } }, ["paymentDate"])]),
      ).toEqual(["paymentDate"]);
    });

    it("does not count another pass's ungroundable list", () => {
      expect(
        lowConfidenceFields([
          pass({ paymentDate: { confidence: 0.3 } }),
          pass({}, ["paymentDate"]),
        ]),
      ).toEqual([]);
    });

    it("never flags period for confidence alone, since it is never ungroundable", () => {
      expect(lowConfidenceFields([pass({ period: { confidence: 0.1 } })])).toEqual([]);
    });

    it("leaves a path outside the gate unchanged", () => {
      expect(lowConfidenceFields([pass({ employerOib: { confidence: 0.3 } })])).toEqual([
        "employerOib",
      ]);
    });
  });
});
