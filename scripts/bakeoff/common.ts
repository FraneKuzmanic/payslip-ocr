import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXPECTED_DIR = join(ROOT, ".agents", "fixtures", "expected");
export const SAMPLES_DIR = join(ROOT, "payslip_examples");
export const CACHE_DIR = join(ROOT, ".bakeoff");

/** The canonical field set. Order is the order the review form will show them in. */
export const SCALAR_FIELDS = [
  "employerName",
  "employerAddress",
  "employerOib",
  "employerIban",
  "employeeName",
  "employeeAddress",
  "employeeOib",
  "employeeIban",
  "period",
  "paymentDate",
  "ukupnoSati",
  "currency",
  "brutoPlaca",
  "doprinosiIzPlace",
  "doprinosMioIStup",
  "doprinosMioIiStup",
  "dohodak",
  "osobniOdbitak",
  "poreznaOsnovica",
  "porezNaDohodak",
  "netoPlaca",
  "neoporeziviPrimiciUkupno",
  "obustaveUkupno",
  "iznosZaIsplatu",
  "doprinosiNaPlacu",
  "ukupanTrosakRada",
] as const;

export type ScalarField = (typeof SCALAR_FIELDS)[number];

/** PRD 6.5 — drives warnings and the headline score. */
export const CRITICAL_FIELDS: ScalarField[] = [
  "employerName",
  "employeeName",
  "employeeOib",
  "period",
  "brutoPlaca",
  "netoPlaca",
  "iznosZaIsplatu",
];

export interface Expected {
  sample: string;
  sourceFile: string;
  layoutFamily: string;
  sourceKind: string;
  pageCount: number;
  unscorable?: { field: string; reason: string }[];
  notes?: string[];
  [k: string]: unknown;
}

export function loadExpected(): Expected[] {
  return readdirSync(EXPECTED_DIR)
    .filter((f) => f.endsWith(".json"))
    .toSorted()
    .map((f) => JSON.parse(readFileSync(join(EXPECTED_DIR, f), "utf8")) as Expected);
}

export function sourceBytes(e: Expected): { bytes: Buffer; contentType: string } {
  const path = join(SAMPLES_DIR, e.sourceFile);
  if (!existsSync(path)) throw new Error(`missing source file: ${path}`);
  const ext = e.sourceFile.split(".").pop()!.toLowerCase();
  const contentType =
    ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
  return { bytes: readFileSync(path), contentType };
}

export function cachePath(kind: string, sample: string): string {
  const dir = join(CACHE_DIR, kind);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${sample}.json`);
}

export function readCache<T>(kind: string, sample: string): T | null {
  const p = cachePath(kind, sample);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

export function writeCache(kind: string, sample: string, data: unknown): void {
  writeFileSync(cachePath(kind, sample), JSON.stringify(data, null, 2), "utf8");
}

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n  Missing ${name} in prototypes/payslip-ocr/.env — cannot run.\n`);
    process.exit(1);
  }
  return v;
}

export function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
