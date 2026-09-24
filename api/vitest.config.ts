import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Placeholders only, so unit tests never need a real .env. No unit test may reach these:
    // token verification is always driven by an injected Authenticator stub.
    env: {
      LOG_LEVEL: "silent",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      STORAGE_BUCKET: "payslip-sources",
    },
  },
});
