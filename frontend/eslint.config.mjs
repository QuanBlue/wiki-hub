import { defineConfig } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";

// eslint-config-next 16 ships native flat config, so the legacy `FlatCompat`
// bridge that create-next-app scaffolds is neither needed nor compatible.
export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
      // Vitest's HTML coverage report ships vendored JS with its own
      // eslint-disable headers; linting generated output is noise.
      "coverage/**",
    ],
  },
  ...next,
  prettier,
  {
    // Scoped to TypeScript files: that is where eslint-config-next registers
    // the @typescript-eslint plugin these rules belong to.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
