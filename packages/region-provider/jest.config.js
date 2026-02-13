/** @type {import('jest').Config} */
const baseConfig = require("../jest.config.base.js");

module.exports = {
  ...baseConfig,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    "^@opuspopuli/region-plugin-sdk$":
      "<rootDir>/../region-plugin-sdk/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
