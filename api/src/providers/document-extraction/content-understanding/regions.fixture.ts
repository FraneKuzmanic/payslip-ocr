import type { Json } from "../../../database.types.js";

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
