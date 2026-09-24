import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "api-integration",
    environment: "node",
    include: ["src/**/*.integration.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      LOG_LEVEL: "silent",
      STORAGE_BUCKET: "payslip-sources",
    },
  },
});
