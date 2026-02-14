/** @type {import('jest').Config} */
const baseConfig = require("../jest.config.base.js");

module.exports = {
  ...baseConfig,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    "^@opuspopuli/extraction-provider$":
      "<rootDir>/../extraction-provider/src/index.ts",
    "^@opuspopuli/llm-provider$": "<rootDir>/../llm-provider/src/index.ts",
    "^@opuspopuli/relationaldb-provider$":
      "<rootDir>/../relationaldb-provider/src/index.ts",
  },
  // Relax coverage thresholds for Phase 1 — not all code paths
  // are tested at unit level (pipeline service needs integration tests)
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
};
