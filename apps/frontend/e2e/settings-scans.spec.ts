import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const mockHistoryItems = [
  {
    id: "doc-1",
    type: "petition",
    status: "ai_analysis_complete",
    summary: "Reform criminal sentencing guidelines",
    ocrConfidence: 95.5,
    hasAnalysis: true,
    createdAt: "2024-06-15T10:00:00Z",
  },
  {
    id: "doc-2",
    type: "petition",
    status: "text_extraction_complete",
    summary: null,
    ocrConfidence: 80.0,
    hasAnalysis: false,
    createdAt: "2024-06-10T10:00:00Z",
  },
];

const mockScanDetail = {
  id: "doc-1",
  type: "petition",
  status: "ai_analysis_complete",
  extractedText: "We the undersigned petition for reform",
  ocrConfidence: 95.5,
  ocrProvider: "tesseract",
  analysis: {
    documentType: "petition",
    summary: "This petition seeks to reform criminal sentencing.",
    keyPoints: ["Reduces penalties", "Reclassifies offenses"],
    entities: ["State Legislature"],
    analyzedAt: new Date().toISOString(),
    provider: "Ollama",
    model: "llama3.2",
    processingTimeMs: 1500,
    sources: [],
    completenessScore: 80,
    completenessDetails: {
      availableCount: 4,
      idealCount: 5,
      missingItems: ["Financial impact data"],
      explanation: "Based on 4 of 5 sources.",
    },
    relatedMeasures: [],
    actualEffect: "Would reduce prison populations",
    potentialConcerns: [],
    beneficiaries: [],
    potentiallyHarmed: [],
  },
  createdAt: "2024-06-15T10:00:00Z",
  updatedAt: "2024-06-15T10:00:00Z",
};

async function setupAuthAndMocks(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        id: "test-user-id",
        email: "test@example.com",
        roles: ["user"],
      }),
    );
  });

  await page.route("**/api", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
      return;
    }
    const postData = route.request().postDataJSON();

    if (postData?.query?.includes("MyScanHistory")) {
      const vars = postData.variables;
      const items =
        vars?.filters?.search === "nonexistent" ? [] : mockHistoryItems;
      const total = items.length;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            myScanHistory: {
              items,
              total,
              hasMore: false,
            },
          },
        }),
      });
      return;
    }

    if (postData?.query?.includes("ScanDetail")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { scanDetail: mockScanDetail },
        }),
      });
      return;
    }

    if (postData?.query?.includes("GetLinkedPropositions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { linkedPropositions: [] },
        }),
      });
      return;
    }

    if (postData?.query?.includes("SoftDeleteScan")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { softDeleteScan: true },
        }),
      });
      return;
    }

    if (postData?.query?.includes("DeleteAllMyScans")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { deleteAllMyScans: { deletedCount: 2 } },
        }),
      });
      return;
    }

    // Default: pass through
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: {} }),
    });
  });
}

test.describe("My Scans (settings)", () => {
  test("should display scan history list", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans");

    await expect(
      page.getByText("Reform criminal sentencing guidelines"),
    ).toBeVisible({ timeout: 15000 });
    // Second item shows type since summary is null
    await expect(page.getByText("petition").first()).toBeVisible();
  });

  test("should show empty state when no scans", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "auth_user",
        JSON.stringify({
          id: "test-user-id",
          email: "test@example.com",
          roles: ["user"],
        }),
      );
    });

    await page.route("**/api", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: {} }),
        });
        return;
      }
      const postData = route.request().postDataJSON();
      if (postData?.query?.includes("MyScanHistory")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              myScanHistory: { items: [], total: 0, hasMore: false },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
    });

    await page.goto("/settings/scans");

    await expect(page.getByText(/no scans/i)).toBeVisible({ timeout: 15000 });
  });

  test("should navigate from history to scan detail", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans");

    await expect(
      page.getByText("Reform criminal sentencing guidelines"),
    ).toBeVisible({ timeout: 15000 });

    await page
      .getByRole("link", { name: /view scan detail/i })
      .first()
      .click();

    await expect(
      page.getByText("This petition seeks to reform criminal sentencing."),
    ).toBeVisible({ timeout: 15000 });
  });

  test("should show delete confirmation dialog", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans");

    await expect(
      page.getByText("Reform criminal sentencing guidelines"),
    ).toBeVisible({ timeout: 15000 });

    await page
      .getByLabel(/delete scan/i)
      .first()
      .click();

    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("should navigate from petition home to the settings scans list", async ({
    page,
  }) => {
    await setupAuthAndMocks(page);
    await page.goto("/petition");

    await expect(page.getByText("My Scans")).toBeVisible({ timeout: 15000 });
    await page.getByText("My Scans").click();

    await expect(page).toHaveURL(/\/settings\/scans/);
  });

  test("accessibility: history list page meets WCAG AA", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans");

    await expect(
      page.getByText("Reform criminal sentencing guidelines"),
    ).toBeVisible({ timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["color-contrast"]) // Dark theme with dynamic backgrounds
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("should execute delete after confirmation", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans");

    await expect(
      page.getByText("Reform criminal sentencing guidelines"),
    ).toBeVisible({ timeout: 15000 });

    await page
      .getByLabel(/delete scan/i)
      .first()
      .click();

    await expect(page.getByRole("dialog")).toBeVisible();

    // Click delete confirmation button
    await page
      .getByRole("button", { name: /delete/i })
      .last()
      .click();

    // Dialog should close
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("should filter history with search input", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans");

    await expect(
      page.getByText("Reform criminal sentencing guidelines"),
    ).toBeVisible({ timeout: 15000 });

    // Type a search that returns no results
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("nonexistent");

    // Wait for debounced search to trigger empty state
    await expect(page.getByText(/no scans match/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("accessibility: scan detail page meets WCAG AA", async ({ page }) => {
    await setupAuthAndMocks(page);
    await page.goto("/settings/scans/doc-1");

    await expect(
      page.getByText("This petition seeks to reform criminal sentencing."),
    ).toBeVisible({ timeout: 15000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["color-contrast"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  /**
   * The old /petition/history routes are kept as redirects (#1069): scan links
   * have been shared, and installed PWAs have the old shell cached, so a 404
   * would strand users who are entitled to the page.
   */
  test("redirects the old history list to the settings list", async ({
    page,
  }) => {
    await setupAuthAndMocks(page);
    await page.goto("/petition/history");

    await expect(page).toHaveURL(/\/settings\/scans$/, { timeout: 15000 });
  });

  test("redirects an old scan link to the same scan, not just the list", async ({
    page,
  }) => {
    await setupAuthAndMocks(page);
    await page.goto("/petition/history/doc-1");

    await expect(page).toHaveURL(/\/settings\/scans\/doc-1$/, {
      timeout: 15000,
    });
  });
});
