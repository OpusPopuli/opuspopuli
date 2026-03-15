import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the civic engagement headline", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Know your ballot/i, level: 1 }),
    ).toBeVisible();
  });

  test("should have sign in link", async ({ page }) => {
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("should display feature cards", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Ballot & Propositions/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Petition Scanner/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Representatives & Meetings/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Campaign Finance/i }),
    ).toBeVisible();
  });

  test("should display trust signals section", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Built on trust and transparency/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /AI Transparency/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Privacy First/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Open Source/i }),
    ).toBeVisible();
  });

  test("should display Get Started CTA for unauthenticated users", async ({
    page,
  }) => {
    await expect(
      page.getByRole("link", { name: /get started/i }),
    ).toBeVisible();
  });

  test("should be accessible", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
