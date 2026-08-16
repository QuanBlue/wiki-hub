import { defineConfig } from "@playwright/test";

/**
 * Keep browser specs separate from Vitest's component/unit tests. Without an
 * explicit test directory Playwright discovers `tests/*.test.tsx` and tries to
 * execute Vitest modules in its CommonJS runner.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  },
});
