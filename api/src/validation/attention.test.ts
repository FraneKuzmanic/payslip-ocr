import { describe, expect, it } from "vitest";
import { lowConfidenceFields } from "./attention.js";

describe("lowConfidenceFields", () => {
  it("flags a confidence below 0.5 and not one at 0.5", () => {
    expect(
      lowConfidenceFields([
        { fields: { netoPlaca: { confidence: 0.49 }, dohodak: { confidence: 0.5 } } },
      ]),
    ).toEqual(["netoPlaca"]);
  });

  it("does not flag an unknown confidence", () => {
    expect(lowConfidenceFields([{ fields: { period: { confidence: null } } }])).toEqual([]);
  });

  it("keeps pass order, scalars first", () => {
    expect(
      lowConfidenceFields([
        { fields: { brutoPlaca: { confidence: 0.1 }, period: { confidence: 0.2 } } },
        { fields: { "payComponents.0.iznos": { confidence: 0.3 } } },
      ]),
    ).toEqual(["brutoPlaca", "period", "payComponents.0.iznos"]);
  });

  it("lists a path once when two passes both flag it", () => {
    expect(
      lowConfidenceFields([
        { fields: { netoPlaca: { confidence: 0.1 } } },
        { fields: { netoPlaca: { confidence: 0.2 } } },
      ]),
    ).toEqual(["netoPlaca"]);
  });
});
