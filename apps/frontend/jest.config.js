const nextJest = require("next/jest");

/** @type {import('jest').Config} */
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
});

// Add any custom config to be passed to Jest
const config = {
  preset: "ts-jest",
  testEnvironment: "jest-environment-jsdom",
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "!app/**/layout.tsx",
    "!app/robots.ts",
    "!app/sitemap.ts",
    // Exclude legacy password-based flows (not part of passwordless auth)
    "!app/(auth)/forgot-password/**",
    "!app/(auth)/reset-password/**",
    // Exclude barrel/index files
    "!lib/**/index.ts",
    "!**/*.d.ts",
    "!**/node_modules/**",
  ],
  coverageThreshold: {
    global: {
      // Global thresholds account for excluded legacy password flows (forgot/reset-password)
      // Per-file thresholds below enforce higher coverage on tested files
      branches: 60,
      functions: 60,
      lines: 35,
      statements: 35,
    },
    // RAG demo page has SSR guards and Toast auto-dismiss timer
    "app/rag-demo/page.tsx": {
      branches: 70,
      functions: 90,
      lines: 100,
      statements: 100,
    },
    // Auth pages with RTL tests
    // Lower thresholds to account for WCAG accessibility attributes (aria-hidden, aria-label)
    // which are static and don't require unit tests
    "app/(auth)/login/page.tsx": {
      branches: 76,
      functions: 69,
      lines: 84,
      statements: 84,
    },
    "app/(auth)/register/page.tsx": {
      branches: 100,
      functions: 66,
      lines: 100,
      statements: 100,
    },
    "app/(auth)/register/add-passkey/page.tsx": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "app/(auth)/auth/callback/page.tsx": {
      branches: 85,
      functions: 80,
      lines: 86,
      statements: 86,
    },
    // Auth hooks and context
    "lib/hooks/useMagicLink.ts": {
      branches: 70,
      functions: 100,
      lines: 99,
      statements: 99,
    },
    "lib/hooks/usePasskey.ts": {
      branches: 70,
      functions: 60,
      lines: 97,
      statements: 97,
    },
    "lib/auth-context.tsx": {
      branches: 60,
      functions: 100,
      lines: 89,
      statements: 89,
    },
  },
  verbose: true,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  modulePathIgnorePatterns: ["<rootDir>/.next"],
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/e2e/",
    "<rootDir>/__tests__/utils/",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(config);
