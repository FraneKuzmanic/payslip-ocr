import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Provider vocabulary lives in exactly one `api/src` module (PRD §6.2, Task 04 D4). The same
 * regex as the `shared/src` guard in `shared/src/payslip.test.ts`.
 */
const ALLOWED_PREFIXES = [
  // The one module that speaks the provider's language.
  "providers/document-extraction/content-understanding/",
  // Environment-variable names (`AZURE_…`) are deployment configuration, not domain vocabulary.
  "config.ts",
  // This test names the vocabulary it bans, so it necessarily contains it.
  "provider-vocabulary.test.ts",
];

describe("provider independence", () => {
  it("keeps provider vocabulary inside the content-understanding module", () => {
    const forbidden =
      /azure|prebuilt|documentintelligence|contentunderstanding|content understanding|analyzeresult|analyzer|boundingregion|polygon|valuestring|valuearray|valueobject/i;
    const directory = fileURLToPath(new URL(".", import.meta.url));

    const offenders = readdirSync(directory, { recursive: true, encoding: "utf8" })
      // Windows returns `\`-separated paths; the allow-list is written with `/`.
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => !ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .filter((name) => forbidden.test(readFileSync(join(directory, name), "utf8")));

    expect(offenders).toEqual([]);
  });
});
