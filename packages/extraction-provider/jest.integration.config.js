/** @type {import('jest').Config} */
const baseConfig = require("../jest.config.base.js");

module.exports = {
  ...baseConfig,
  // Integration tests only
  testMatch: ["**/__tests__/integration/**/*.spec.ts"],
  // Longer timeout for real Redis operations
  testTimeout: 30000,
  // Global setup/teardown
  globalSetup: "<rootDir>/__tests__/integration/setup.ts",
  globalTeardown: "<rootDir>/__tests__/integration/teardown.ts",
  // No coverage for integration tests (covered by unit tests)
  collectCoverage: false,
};
