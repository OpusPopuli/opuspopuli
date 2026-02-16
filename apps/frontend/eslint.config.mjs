import nextPlugin from "eslint-config-next";
import prettierConfigRecommended from "eslint-plugin-prettier/recommended";

const config = [
  ...nextPlugin,
  prettierConfigRecommended, // Last since it disables some previously set rules
  {
    ignores: [
      ".next/*",
      "jest.config.js",
      "cypress.config.ts",
      "public/sw.js",
      "playwright-report/*",
      "test-results/*",
    ],
  },
];

export default config;
