import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

function values(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === "string" ? [value] : values(value),
  );
}

const pluralSuffix = /_(zero|one|two|few|many|other)$/;

function baseKeys(tree: Tree) {
  return [...new Set(flatten(tree).map((key) => key.replace(pluralSuffix, "")))].toSorted();
}

function pluralCategories(tree: Tree) {
  const groups = new Map<string, string[]>();
  for (const key of flatten(tree)) {
    const match = key.match(pluralSuffix);
    if (!match) continue;
    const baseKey = key.replace(pluralSuffix, "");
    groups.set(baseKey, [...(groups.get(baseKey) ?? []), match[1]!]);
  }
  return groups;
}

/**
 * Guards PRD §7.13 for every later task: adding a key to one language only fails here.
 */
describe("locale resources", () => {
  it("hr and en have matching base key sets", () => {
    expect(baseKeys(hr)).toEqual(baseKeys(en));
  });

  it.each([
    ["en", en],
    ["hr", hr],
  ] as const)("%s has the CLDR plural categories for each plural key", (language, tree) => {
    const categories = pluralCategories(tree);
    const expected = new Intl.PluralRules(language).resolvedOptions().pluralCategories.toSorted();

    for (const actual of categories.values()) {
      expect(actual.toSorted()).toEqual(expected);
    }
  });

  it.each([
    ["en", en],
    ["hr", hr],
  ])("%s has no empty values", (_name, tree) => {
    for (const value of values(tree)) {
      expect(value.trim()).not.toBe("");
    }
  });
});
