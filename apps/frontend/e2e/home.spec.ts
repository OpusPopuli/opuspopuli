import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should lead with the county question", async ({ page }) => {
    await expect(
      page.getByRole("heading", {
        name: /Who governs your county\?/i,
        level: 1,
      }),
    ).toBeVisible();
  });

  test("should cite the statute that sets the threshold", async ({ page }) => {
    await expect(page.getByText(/Elections Code §9118/i).first()).toBeVisible();
  });

  test("should make the argument under the hero", async ({ page }) => {
    for (const key of [
      /county is not a convenience/i,
      /right already exists/i,
      /changed the cost, not the citizen/i,
      /Do not take our word/i,
    ]) {
      await expect(page.getByRole("heading", { name: key })).toBeVisible();
    }
  });

  test("should keep the transparency and privacy links reachable", async ({
    page,
  }) => {
    await expect(
      page.locator('main a[href="/transparency"]').first(),
    ).toBeVisible();
    await expect(page.locator('main a[href="/privacy"]').first()).toBeVisible();
  });

  test("should offer both ways in for unauthenticated users", async ({
    page,
  }) => {
    await expect(
      page.locator('main a[href="/register"]').first(),
    ).toBeVisible();
    await expect(page.locator('main a[href="/login"]').first()).toBeVisible();
  });

  test("should be accessible", async ({ page }) => {
    // Wait for the page to finish rendering before scanning. axe on a
    // mid-hydration DOM catches transient violations (unlabeled controls,
    // duplicate ids during hydration) that resolve once settled — which
    // flaked intermittently and recovered on retry.
    await expect(
      page.getByRole("heading", {
        name: /Who governs your county\?/i,
        level: 1,
      }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
