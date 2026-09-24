/**
 * Estimated cost of Content Understanding analyses, from the `usage` block each retained response
 * carries (Task 04 D17). It lives in the provider module because `usage` is provider vocabulary.
 *
 * List prices, not re-verified: $5 per 1,000 standard pages, $1 per M contextualization tokens,
 * and gpt-4.1 at $2 / $0.50 / $8 per M uncached input / cached input / output tokens.
 */
const PRICE_PER_PAGE = 5 / 1000;
const PRICE_PER_CONTEXTUALIZATION_TOKEN = 1 / 1e6;
const PRICE_PER_INPUT_TOKEN = 2 / 1e6;
const PRICE_PER_CACHED_INPUT_TOKEN = 0.5 / 1e6;
const PRICE_PER_OUTPUT_TOKEN = 8 / 1e6;

export const COST_ASSUMPTIONS =
  "list prices, not re-verified: $5/1k pages, $1/M contextualization, gpt-4.1 $2/$0.50/$8 per M uncached input/cached input/output";

export interface UsageEstimate {
  readonly pages: number;
  readonly contextualizationTokens: number;
  /** Input tokens excluding the cached ones, which the service reports inside the input count. */
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
}

interface Usage {
  documentPagesStandard?: number;
  contextualizationTokens?: number;
  tokens?: Record<string, number>;
}

export function estimateUsageCost(responses: readonly unknown[]): UsageEstimate {
  let pages = 0;
  let contextualizationTokens = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;

  for (const response of responses) {
    const usage = (response as { usage?: Usage } | null)?.usage ?? {};
    pages += usage.documentPagesStandard ?? 0;
    contextualizationTokens += usage.contextualizationTokens ?? 0;
    for (const [name, count] of Object.entries(usage.tokens ?? {})) {
      if (name.endsWith("-cached-input")) cachedInputTokens += count;
      else if (name.endsWith("-input")) inputTokens += count;
      else if (name.endsWith("-output")) outputTokens += count;
    }
  }

  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return {
    pages,
    contextualizationTokens,
    uncachedInputTokens,
    cachedInputTokens,
    outputTokens,
    usd:
      pages * PRICE_PER_PAGE +
      contextualizationTokens * PRICE_PER_CONTEXTUALIZATION_TOKEN +
      uncachedInputTokens * PRICE_PER_INPUT_TOKEN +
      cachedInputTokens * PRICE_PER_CACHED_INPUT_TOKEN +
      outputTokens * PRICE_PER_OUTPUT_TOKEN,
  };
}
