import { defineConfig, devices } from "@playwright/test";

// In CI, use production build (port 3000). Locally, use dev server (port 3200).
const isCI = !!process.env.CI;
const port = isCI ? 3000 : 3200;
const baseURL = `http://localhost:${port}`;

/**
 * Playwright E2E Test Configuration
 *
 * @see https://playwright.dev/docs/test-configuration
 *
 * Projects:
 * - chromium: Desktop Chrome (primary)
 * - firefox: Desktop Firefox
 * - webkit: Desktop Safari
 * - mobile-chrome: Mobile Chrome (Pixel 5)
 * - mobile-safari: Mobile Safari (iPhone 12)
 * - tablet: Tablet (iPad)
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ["html", { open: isCI ? "never" : "on-failure" }],
    ["list"], // Console output
    ...(isCI ? [["github"] as const] : []), // GitHub Actions annotations
  ],

  // Shared settings for all projects
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    // Accessibility testing defaults
    bypassCSP: false,
    ignoreHTTPSErrors: false,
  },

  // Test timeout
  timeout: 30000,
  expect: {
    timeout: 5000,
  },

  projects: [
    // =====================
    // Desktop Browsers
    // =====================
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Enable service worker for PWA tests in CI
        serviceWorkers: isCI ? "allow" : "block",
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },

    // =====================
    // Mobile Devices
    // =====================
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        // Test mobile-specific viewport
        hasTouch: true,
      },
    },
    {
      name: "mobile-safari",
      use: {
        ...devices["iPhone 12"],
        hasTouch: true,
      },
    },

    // =====================
    // Tablet
    // =====================
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        hasTouch: true,
      },
    },
  ],

  webServer: {
    // In CI, use standalone server (Next.js output: standalone). Locally, use dev server.
    // Note: standalone output preserves monorepo structure, so server.js is at apps/frontend/
    command: isCI
      ? "node .next/standalone/apps/frontend/server.js"
      : "pnpm run dev",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120000, // 2 minutes for server startup
  },
});
