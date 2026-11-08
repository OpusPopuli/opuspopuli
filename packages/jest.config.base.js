/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.spec.ts"],
  // At most half the cores. Jest's default is one fewer than all of them,
  // and on a 14-core Mac running Ollama and Docker, 13 workers at 1-2 GB
  // each pushed the machine into swap until it froze (2026-11-07).
  // A --maxWorkers flag still overrides this.
  maxWorkers: "50%",
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/index.ts"],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    "^@opuspopuli/common$": "<rootDir>/../common/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
        useESM: false,
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
};
