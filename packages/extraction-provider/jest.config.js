/** @type {import('jest').Config} */
const baseConfig = require("../jest.config.base.js");

module.exports = {
  ...baseConfig,
  // Exclude integration tests from unit test runs
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/integration/"],
  // Override coverage thresholds - Redis implementations require a running Redis server
  // and are tested via integration tests, not unit tests
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 80,
      functions: 70,
      lines: 70,
    },
  },
};
