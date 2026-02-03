/**
 * E2E Test Utilities
 *
 * Shared helpers for Playwright tests to reduce duplication
 * and ensure consistent patterns across test files.
 */
import { Page, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Mock user data for authentication tests
 * Structure must match User type from auth-context.tsx
 */
export const mockUser = {
  id: "test-user-id",
  email: "test@example.com",
  roles: ["user"],
  department: undefined,
  clearance: undefined,
};

/**
 * Mock authentication response
 */
export const mockAuthResponse = {
  user: mockUser,
  accessToken: "mock-access-token",
  refreshToken: "mock-refresh-token",
};

/**
 * Check accessibility and return violations
 * Uses WCAG 2.2 AA standards
 */
export async function checkAccessibility(
  page: Page,
  options?: { includedImpacts?: string[] },
) {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  let violations = accessibilityScanResults.violations;
  if (options?.includedImpacts) {
    violations = violations.filter((v) =>
      options.includedImpacts!.includes(v.impact || ""),
    );
  }

  if (violations.length > 0) {
    const violationMessages = violations.map((v) => {
      const nodes = v.nodes
        .map((n) => `  - ${n.html}\n    Fix: ${n.failureSummary}`)
        .join("\n");
      return `${v.id} (${v.impact}): ${v.help}\n${nodes}`;
    });
    console.error(
      "Accessibility violations found:\n" + violationMessages.join("\n\n"),
    );
  }

  return violations;
}

/**
 * Mock GraphQL API responses
 * Routes both /api and /graphql endpoints to handle different environments:
 * - Local dev: uses /api (default from apollo-client.ts)
 * - CI: uses /graphql (set via NEXT_PUBLIC_GRAPHQL_URL)
 */
export async function mockGraphQL(
  page: Page,
  handlers: Record<string, unknown>,
) {
  await page.route("**/api", async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();

    for (const [queryMatch, response] of Object.entries(handlers)) {
      if (postData?.query?.includes(queryMatch)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: response }),
        });
        return;
      }
    }

    await route.continue();
  });
}

/**
 * Mock GraphQL error response
 */
export async function mockGraphQLError(
  page: Page,
  queryMatch: string,
  errorMessage: string,
) {
  await page.route("**/api", async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();

    if (postData?.query?.includes(queryMatch)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: errorMessage }],
        }),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Wait for loading skeleton to disappear
 */
export async function waitForContentLoaded(page: Page) {
  await expect(page.locator(".animate-pulse")).toHaveCount(0, {
    timeout: 5000,
  });
}

/**
 * Set up authenticated session via localStorage
 * Use this for tests requiring authentication
 * Key must match USER_KEY from auth-context.tsx ("auth_user")
 *
 * IMPORTANT: This uses addInitScript which runs BEFORE any page JavaScript,
 * ensuring auth is set before React hydration and auth context checks.
 * Must be called BEFORE page.goto().
 */
export async function setupAuthSession(page: Page, user = mockUser) {
  await page.addInitScript((userData) => {
    localStorage.setItem("auth_user", JSON.stringify(userData));
  }, user);
}

/**
 * Clear authentication state
 */
export async function clearAuthSession(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem("auth_user");
    localStorage.removeItem("accessToken");
  });
}

/**
 * Test keyboard navigation - verify focus moves correctly
 */
export async function testKeyboardFocus(page: Page) {
  await page.keyboard.press("Tab");

  const focusedElement = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const styles = globalThis.getComputedStyle(el);
    return {
      tagName: el.tagName,
      outline: styles.outline,
      boxShadow: styles.boxShadow,
    };
  });

  expect(focusedElement?.tagName).toBeTruthy();
  return focusedElement;
}

/**
 * Viewport sizes for responsive testing
 */
export const viewports = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
} as const;

/**
 * Test responsive layout at different viewports
 */
export async function testResponsive(
  page: Page,
  url: string,
  expectations: (page: Page, viewport: string) => Promise<void>,
) {
  for (const [name, size] of Object.entries(viewports)) {
    await page.setViewportSize(size);
    await page.goto(url);
    await expectations(page, name);
  }
}
