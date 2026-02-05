import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the Opus Populi title", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Opus Populi/i, level: 1 }),
    ).toBeVisible();
  });

  test("should have sign in link", async ({ page }) => {
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
