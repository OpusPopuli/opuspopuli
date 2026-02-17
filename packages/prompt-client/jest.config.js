/** @type {import('jest').Config} */
const baseConfig = require("../jest.config.base.js");

module.exports = {
  ...baseConfig,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    "^@opuspopuli/relationaldb-provider$":
      "<rootDir>/../relationaldb-provider/src/index.ts",
  },
};
