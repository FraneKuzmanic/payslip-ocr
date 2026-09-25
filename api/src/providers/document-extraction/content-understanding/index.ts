import { config } from "../../../config.js";
import type { DocumentExtractionProvider } from "../types.js";
import { ContentUnderstandingProvider } from "./provider.js";

/**
 * The application's extraction provider, built from `config`. Reading the configuration here
 * keeps every provider-specific setting name out of `app.ts` (Task 04 D4). No network call is
 * made at construction.
 */
export function createDocumentExtractionProvider(): DocumentExtractionProvider {
  return new ContentUnderstandingProvider({
    endpoint: config.AZURE_CONTENT_UNDERSTANDING_ENDPOINT,
    key: config.AZURE_CONTENT_UNDERSTANDING_KEY,
    analyzerFamilyId: config.AZURE_CU_ANALYZER_ID,
    apiVersion: config.AZURE_CU_API_VERSION,
  });
}
