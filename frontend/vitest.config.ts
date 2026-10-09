import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // Next resolves `server-only` from its own compiled copy; outside Next
      // it is not installed. Its "empty" build is what server code gets.
      "server-only": "next/dist/compiled/server-only/empty.js",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // The default 5s is too tight for the longer form-filling tests once
    // coverage instrumentation slows every file down - they time out
    // intermittently rather than fail on anything real.
    testTimeout: 15_000,
    include: ["tests/**/*.test.{ts,tsx}"],
    // Playwright specs live in e2e/ and are run by `npm run test:e2e`.
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html", "json-summary"],
      reportsDirectory: "coverage",
      // `all` counts files no test imports. Without it the percentage only
      // describes the handful of modules already under test, which reads as
      // "we're at 95%" while most of the app is untouched.
      all: true,
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "hooks/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
        "middleware.ts",
      ],
      exclude: [
        // Type-only modules compile to nothing, so they would otherwise show
        // up as permanently 0%-covered files that can never be improved.
        "types/**",
        "**/*.d.ts",
      ],
      // A ratchet, not a target: raise these as coverage grows, never lower
      // them. lib/, hooks/ and middleware are fully covered and must stay so.
      // The global floor sits a little under the container's figure because
      // the host's coverage provider counts lines differently (more of them),
      // and both runs must pass.
      thresholds: {
        lines: 77,
        "lib/**": { lines: 100 },
        "hooks/**": { lines: 100 },
        "middleware.ts": { lines: 100 },
        "components/admin/{edit-user-dialog,edit-group-dialog,edit-space-modal,space-access-panel,storage-panel,group-manager,group-usage-panel,group-usage-dialog,group-global-access-table,create-group-dialog,bulk-select}.tsx":
          { lines: 100 },
        "components/admin/{site-settings-form,font-specimen-modal}.tsx": { lines: 100 },
        "components/users/user-profile.tsx": { lines: 100 },
        "components/pages/space-workspace.tsx": { lines: 100 },
        "components/pages/page-history-modal.tsx": { lines: 100 },
        "components/spaces/create-space-form.tsx": { lines: 100 },
        "components/layout/{search-modal,sidebar,sidebar-context}.tsx": { lines: 100 },
        "components/theme-color-provider.tsx": { lines: 100 },
      },
    },
  },
});
