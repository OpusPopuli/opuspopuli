import type { Config } from 'jest';
// import { defaults } from 'jest-config';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    String.raw`.*\.integration\.spec\.ts$`,
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    'src/db/migrations/',
    'src/db/entities/',
    String.raw`/main\.ts$`,
    String.raw`/tracing\.ts$`,
    String.raw`src/common/bootstrap\.ts$`,
    String.raw`src/config/index\.ts$`,
    String.raw`src/config/.*\.config\.ts$`,
    String.raw`\.dto\.ts$`,
    String.raw`\.model\.ts$`,
    String.raw`\.module\.ts$`,
    String.raw`src/apps/[^/]+/src/scripts/`,
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
  verbose: true,
  rootDir: '.',
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
