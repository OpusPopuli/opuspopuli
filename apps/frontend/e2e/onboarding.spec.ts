/**
 * Onboarding Flow E2E Tests
 *
 * Tests for the first-time user onboarding experience:
 * Welcome → Scan → Analyze → Track → redirect to /petition
 */
import { test, expect } from "@playwright/test";
import {
  setupAuthSession,
  checkAccessibility,
  viewports,
} from "./utils/test-helpers";

/**
 * Set up an authenticated session WITHOUT onboarding completed.
 * Must be called BEFORE page.goto().
 */
async function setupNewUserSession(page: import("@playwright/test").Page) {
  await setupAuthSession(page);
  // Ensure onboarding flag is NOT set (new user)
  await page.addInitScript(() => {
    localStorage.removeItem("opuspopuli_onboarding_completed");
  });
}

/**
 * Set up an authenticated session WITH onboarding already completed.
 * Must be called BEFORE page.goto().
 */
async function setupReturningUserSession(
  page: import("@playwright/test").Page,
) {
  await setupAuthSession(page);
  await page.addInitScript(() => {
    localStorage.setItem("opuspopuli_onboarding_completed", "true");
  });
}

test.describe("Onboarding Flow", () => {
  test("should display welcome step for new user", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    await expect(page.getByText(/civic engagement companion/i)).toBeVisible();
  });

  test("should navigate through all steps", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    // Step 1: Welcome
    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 2: Scan
    await expect(page.getByText("Scan Petitions")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 3: Analyze
    await expect(page.getByText("Instant Analysis")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 4: Track
    await expect(page.getByText("Track Progress")).toBeVisible();

    // Should show Get Started button on last step
    await expect(
      page.getByRole("button", { name: /get started/i }),
    ).toBeVisible();
  });

  test("should complete onboarding and redirect to /petition", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    // Navigate through all steps
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Click Get Started
    await page.getByRole("button", { name: /get started/i }).click();

    // Should redirect to /petition
    await expect(page).toHaveURL(/\/petition/);
  });

  test("should skip onboarding and redirect to /petition", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await page.getByRole("button", { name: /skip/i }).click();

    // Should redirect to /petition
    await expect(page).toHaveURL(/\/petition/);
  });

  test("should navigate back to previous step", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    // Go to step 2
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Scan Petitions")).toBeVisible();

    // Go back to step 1
    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
  });

  test("back button should be disabled on first step", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    const backButton = page.getByRole("button", { name: /back/i });
    await expect(backButton).toBeDisabled();
  });

  test("should persist completion in localStorage", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    // Verify localStorage is empty before skip
    const before = await page.evaluate(() =>
      localStorage.getItem("opuspopuli_onboarding_completed"),
    );
    expect(before).toBeNull();

    // Listen for localStorage change before clicking
    await page.evaluate(() => {
      (globalThis as unknown as Record<string, string>).__onboardingSet =
        "false";
      const origSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (key: string, value: string) => {
        origSetItem(key, value);
        if (key === "opuspopuli_onboarding_completed") {
          (globalThis as unknown as Record<string, string>).__onboardingSet =
            value;
        }
      };
    });

    // Skip onboarding
    await page.getByRole("button", { name: /skip/i }).click();

    // Verify the flag was set before navigation
    const completed = await page.evaluate(
      () => (globalThis as unknown as Record<string, string>).__onboardingSet,
    );
    expect(completed).toBe("true");
  });
});

test.describe("Onboarding - Returning User", () => {
  test("should redirect completed user to /petition", async ({ page }) => {
    await setupReturningUserSession(page);
    await page.goto("/onboarding");

    await expect(page).toHaveURL(/\/petition/);
  });
});

test.describe("Onboarding - Unauthenticated", () => {
  test("should redirect to /login when not authenticated", async ({ page }) => {
    // Don't set up auth session
    await page.goto("/onboarding");

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Onboarding - Responsive Design", () => {
  test("should display correctly on mobile", async ({ page }) => {
    await setupNewUserSession(page);
    await page.setViewportSize(viewports.mobile);
    await page.goto("/onboarding");

    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    await expect(page.getByRole("button", { name: /skip/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeVisible();
  });

  test("should display correctly on tablet", async ({ page }) => {
    await setupNewUserSession(page);
    await page.setViewportSize(viewports.tablet);
    await page.goto("/onboarding");

    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
  });
});

test.describe("Onboarding - Accessibility", () => {
  test("should have no WCAG 2.2 AA violations on welcome step", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });

  test("should have no WCAG 2.2 AA violations on scan step", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Scan Petitions")).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });
});
