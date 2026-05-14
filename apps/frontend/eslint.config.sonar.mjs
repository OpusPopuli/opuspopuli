// @ts-check
// Sonar rules run separately (no --fix) — sonarjs fixers can corrupt React
// component files. See .husky/pre-push for usage.

import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Inline eslint-disable comments may reference rules from plugins (react-hooks,
  // @next/next, jsx-a11y) that are loaded in the main config but not here.
  // Don't error on disable directives for unknown rules in this config.
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  // Only scan our TypeScript source — exclude .next/, node_modules, and all
  // compiled/generated output so we don't get thousands of false positives.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "public/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  // Register react-hooks plugin so disable comments in source files referencing
  // react-hooks/* rules are recognised and don't trigger "rule not found".
  // All react-hooks rules are off here — they're enforced by the main config.
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: Object.fromEntries(
      Object.keys(reactHooks.rules).map((r) => [`react-hooks/${r}`, "off"]),
    ),
  },
  {
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15],
      // Disable sonarjs auto-fixable rules — their fixers corrupt React files.
      "sonarjs/prefer-while": "off",
      "sonarjs/prefer-immediate-return": "off",
      // react-hooks rules are registered above (all off) — these entries are
      // kept here for clarity and to make intent explicit.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      // @next/next and jsx-a11y plugins are not loaded in this sonar-only
      // config — their rules are enforced by the main ESLint config.
      "@next/next/no-img-element": "off",
      "jsx-a11y/alt-text": "off",
      // Geolocation is an intentional feature of the map/region UI.
      "sonarjs/no-intrusive-permissions": "off",
      // actionTranslationKeys maps backend enum values (PASSWORD_CHANGE,
      // PASSWORD_RESET) — these are not hardcoded credentials.
      "sonarjs/no-hardcoded-passwords": "off",
      // Allow intentional underscore-prefixed unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  // require() inside jest.mock() factory callbacks is a CommonJS Jest pattern
  // and is not an ES-module boundary violation. Disable no-require-imports for
  // test files where this idiom is established.
  {
    files: [
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Playwright e2e specs use test.skip(condition, reason) inside beforeEach
  // as a runtime conditional skip — this is not a permanently-skipped test.
  // The pattern is the established Playwright idiom for project/env filtering.
  {
    files: ["**/e2e/**/*.spec.ts", "**/e2e/**/*.spec.tsx"],
    rules: {
      "sonarjs/no-skipped-tests": "off",
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.test.ts", "**/*.spec.tsx", "**/*.test.tsx"],
    rules: {
      "sonarjs/no-duplicate-string": "off",
    },
  },
  // Suppress globally — test fixtures use fake IPs, local dev uses http://,
  // Math.random() in tests is fine, slow-regex needs a dedicated review.
  {
    rules: {
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/slow-regex": "off",
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "sonarjs/hardcoded-secret-signatures": "off",
    },
  },
);
