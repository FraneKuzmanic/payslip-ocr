import type { Json } from "../../../database.types.js";
import type { ExtractionPass } from "../types.js";
import { mapAnalyzeResult } from "./fields.js";

// A minimal pass body for region tests, here because the vocabulary guard keeps these keys out of
// `routes/` (Task 08). Typed as `Json` so it can be stored as a retained response.

type JsonObject = { [key: string]: Json };

interface FixturePage extends JsonObject {
  pageNumber: number;
  width: number;
  height: number;
}

export function regionsPassBody(
  fields: JsonObject,
  pages: FixturePage[] = [{ pageNumber: 1, width: 8, height: 10 }],
): JsonObject {
  return {
    id: "op",
    status: "Succeeded",
    result: { contents: [{ kind: "document", unit: "inch", pages, fields }] },
  };
}

export function sourced(valueString: string, source: string): JsonObject {
  return { type: "string", valueString, source, confidence: 0.9 };
}

export function rows(...cells: JsonObject[]): JsonObject {
  return {
    type: "array",
    valueArray: cells.map((valueObject) => ({ type: "object", valueObject })),
  };
}

/**
 * One extraction pass's write for `completeExtractionPass`, from a fixture body through the real
 * mapper, as the provider builds it: the hosted edit tests (Task 09) need stored fields that match
 * what `originalExtraction` re-maps from the same body.
 */
export function mappedPass(body: JsonObject, pass: ExtractionPass) {
  const mapped = mapAnalyzeResult(body, pass);
  if (mapped === null) throw new Error("The fixture body does not map.");
  return {
    fields: mapped.fields,
    metadata: {
      fields: mapped.fieldMetadata,
      unreadableFields: mapped.unreadableFields,
      ungroundableFields: mapped.ungroundableFields,
      queuedMs: 1,
    } as unknown as Json,
    raw: body,
  };
}
