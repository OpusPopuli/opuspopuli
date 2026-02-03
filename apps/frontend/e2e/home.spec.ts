import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the Qckstrt title", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Qckstrt/i, level: 1 }),
    ).toBeVisible();
  });

  test("should have sign in link", async ({ page }) => {
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
