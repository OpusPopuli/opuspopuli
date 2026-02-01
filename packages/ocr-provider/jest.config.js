/** @type {import('jest').Config} */
const baseConfig = require("../jest.config.base.js");

module.exports = {
  ...baseConfig,
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
