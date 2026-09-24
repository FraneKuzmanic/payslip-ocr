import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// The repository keeps a single .env at its root; src/ and dist/ sit at the same depth.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const NODE_ENVS = ["development", "test", "production"] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

type NodeEnv = (typeof NODE_ENVS)[number];
type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly PORT: number;
  readonly NODE_ENV: NodeEnv;
  readonly LOG_LEVEL: LogLevel;
  readonly WEB_ORIGIN: string;
  readonly SUPABASE_URL: string;
  readonly SUPABASE_PUBLISHABLE_KEY: string;
  readonly STORAGE_BUCKET: string;
  readonly MAX_UPLOAD_BYTES: number;
  readonly MAX_PDF_PAGES: number;
  readonly AZURE_CONTENT_UNDERSTANDING_ENDPOINT: string;
  readonly AZURE_CONTENT_UNDERSTANDING_KEY: string;
  readonly AZURE_CU_ANALYZER_ID: string;
  readonly AZURE_CU_API_VERSION: string;
  readonly EXTRACTION_TIMEOUT_MS: number;
  readonly EXTRACTION_CONCURRENCY: number;
}

const problems: string[] = [];

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535 (received "${raw}")`);
    return fallback;
  }
  return parsed;
}

function readCount(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    problems.push(`${name} must be a positive integer (received "${raw}")`);
    return fallback;
  }
  return parsed;
}

function readEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw === undefined || raw === "") return fallback;
  if (!allowed.includes(raw as T)) {
    problems.push(`${name} must be one of ${allowed.join(", ")} (received "${raw}")`);
    return fallback;
  }
  return raw as T;
}

/**
 * Required values fail at startup rather than at the first request. A missing Supabase URL
 * cannot be defaulted to anything meaningful, and the alternative — booting fine and then
 * rejecting every authenticated request — is far harder to diagnose.
 */
function readRequired(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    problems.push(`${name} is required`);
    return "";
  }
  return raw;
}

const parsed: Config = {
  PORT: readPort(process.env["PORT"], 3001),
  NODE_ENV: readEnum("NODE_ENV", process.env["NODE_ENV"], NODE_ENVS, "development"),
  LOG_LEVEL: readEnum("LOG_LEVEL", process.env["LOG_LEVEL"], LOG_LEVELS, "info"),
  WEB_ORIGIN: process.env["WEB_ORIGIN"] ?? "http://localhost:5173",
  SUPABASE_URL: readRequired("SUPABASE_URL", process.env["SUPABASE_URL"]),
  SUPABASE_PUBLISHABLE_KEY: readRequired(
    "SUPABASE_PUBLISHABLE_KEY",
    process.env["SUPABASE_PUBLISHABLE_KEY"],
  ),
  STORAGE_BUCKET: readRequired("STORAGE_BUCKET", process.env["STORAGE_BUCKET"]),
  MAX_UPLOAD_BYTES: readCount("MAX_UPLOAD_BYTES", process.env["MAX_UPLOAD_BYTES"], 10485760),
  MAX_PDF_PAGES: readCount("MAX_PDF_PAGES", process.env["MAX_PDF_PAGES"], 10),
  // Required, like Supabase: an API that boots and then fails every extraction is harder to
  // diagnose than one that refuses to start.
  AZURE_CONTENT_UNDERSTANDING_ENDPOINT: readRequired(
    "AZURE_CONTENT_UNDERSTANDING_ENDPOINT",
    process.env["AZURE_CONTENT_UNDERSTANDING_ENDPOINT"],
  ).replace(/\/$/, ""),
  AZURE_CONTENT_UNDERSTANDING_KEY: readRequired(
    "AZURE_CONTENT_UNDERSTANDING_KEY",
    process.env["AZURE_CONTENT_UNDERSTANDING_KEY"],
  ),
  AZURE_CU_ANALYZER_ID: readRequired("AZURE_CU_ANALYZER_ID", process.env["AZURE_CU_ANALYZER_ID"]),
  AZURE_CU_API_VERSION: readRequired("AZURE_CU_API_VERSION", process.env["AZURE_CU_API_VERSION"]),
  EXTRACTION_TIMEOUT_MS: readCount(
    "EXTRACTION_TIMEOUT_MS",
    process.env["EXTRACTION_TIMEOUT_MS"],
    120000,
  ),
  EXTRACTION_CONCURRENCY: readCount(
    "EXTRACTION_CONCURRENCY",
    process.env["EXTRACTION_CONCURRENCY"],
    3,
  ),
};

if (problems.length > 0) {
  throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
}

export const config: Config = Object.freeze(parsed);
