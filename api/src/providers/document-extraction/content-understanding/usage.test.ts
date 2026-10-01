import { describe, expect, it } from "vitest";
import { estimateUsageCost } from "./usage.js";

describe("estimateUsageCost", () => {
  it("sums usage blocks, separating cached from uncached input", () => {
    const usage = {
      documentPagesStandard: 2,
      contextualizationTokens: 2000,
      tokens: { "gpt-4.1-input": 1000, "gpt-4.1-cached-input": 800, "gpt-4.1-output": 500 },
    };

    const estimate = estimateUsageCost([{ usage }, { usage }, { status: "Succeeded" }]);

    expect(estimate).toMatchObject({
      pages: 4,
      contextualizationTokens: 4000,
      uncachedInputTokens: 400,
      cachedInputTokens: 1600,
      outputTokens: 1000,
    });
    // 4 × $0.005 + 4000 × $1/M + 400 × $2/M + 1600 × $0.5/M + 1000 × $8/M
    expect(estimate.usd).toBeCloseTo(0.02 + 0.004 + 0.0008 + 0.0008 + 0.008, 10);
  });

  it("counts both bodies of a scalars pass retained as its two parts (Task 17 D9)", () => {
    const body = {
      result: { contents: [] },
      usage: { documentPagesStandard: 1, tokens: { "gpt-4.1-output": 300 } },
    };

    const estimate = estimateUsageCost([{ header: body, reconciliation: body }, body]);

    expect(estimate).toMatchObject({ pages: 3, outputTokens: 900 });
  });
});
