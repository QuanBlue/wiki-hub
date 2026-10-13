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
        "components/pages/move-page-dialog.tsx": { lines: 100 },
        "components/admin/{storage-quotas-card,space-row-actions,user-row-actions,permission-overrides-table}.tsx": { lines: 100 },
        "components/layout/user-menu.tsx": { lines: 100 },
        "components/recent/recent-activity-feed.tsx": { lines: 100 },
        "app/layout.tsx": { lines: 100 },
        "app/login/page.tsx": { lines: 100 },
        "app/issues/page.tsx": { lines: 100 },
        "app/admin/issues/page.tsx": { lines: 100 },
        "components/recent/saved-pages-list.tsx": { lines: 100 },
        "components/account/shortcut-settings.tsx": { lines: 100 },
        "components/users/user-profile-trigger.tsx": { lines: 100 },
        "components/ui/toaster.tsx": { lines: 100 },
        "components/issues/issue-markdown.tsx": { lines: 100 },
        "components/pages/{slash-command,page-restrictions-dialog}.tsx": { lines: 100 },
        "components/account/sessions-panel.tsx": { lines: 100 },
        "components/system-status.tsx": { lines: 100 },
        "components/spaces/space-card.tsx": { lines: 100 },
        "components/providers.tsx": { lines: 100 },
        "components/navigation-loading.tsx": { lines: 100 },
        "components/layout/{impersonation-banner,language-toggle,navigation-progress,top-bar,app-shell,app-main}.tsx": { lines: 100 },
        "components/ui/scroll-to-top.tsx": { lines: 100 },
        "components/admin/storage-tabs.tsx": { lines: 100 },
        "components/recent/recently-visited-list.tsx": { lines: 100 },
        "components/pages/create-page-dialog.tsx": { lines: 100 },
        "app/**/*.tsx": { lines: 100 },
        "components/admin/{refresh-button,stat-tile,list-controls}.tsx": { lines: 100 },
        "components/layout/{page-header,sidebar-toggle,theme-toggle,home-search-trigger}.tsx": { lines: 100 },
        "components/issues/{report-issue-button,issue-screenshots,issue-export-button,label-picker}.tsx": { lines: 100 },
        "components/pages/{record-visit,page-content-loading,page-attachments-dialog,page-labels-dialog,source-code-editor}.tsx": { lines: 100 },
        "components/spaces/space-list.tsx": { lines: 100 },
        "components/account/{profile-form,profile-summary,change-password-form}.tsx": { lines: 100 },
        "components/auth/login-form.tsx": { lines: 100 },
        "components/comments/likers-popover.tsx": { lines: 100 },
        "components/ui/searchable-select.tsx": { lines: 100 },
        "components/spaces/spaces-explorer.tsx": { lines: 100 },
        "components/admin/{administrators-table,request-actions}.tsx": { lines: 100 },
        "components/layout/{switch-account-dialog,notification-bell,mail-summary-provider}.tsx": { lines: 100 },
        "components/account/account-settings.tsx": { lines: 100 },
        "components/comments/{comment-composer,page-comments,comment-item,comment-filters}.tsx": { lines: 100 },
        "components/help/help-ui.tsx": { lines: 100 },
        "components/ui/{password-input,timezone-combobox}.tsx": { lines: 100 },
        "components/brand/logo.tsx": { lines: 100 },
        "app/admin/{users,spaces}/page.tsx": { lines: 100 },
      },
    },
  },
});
