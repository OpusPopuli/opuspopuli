/**
 * Region search e2e (#1154): header typeahead → results page, with
 * GraphQL mocked via route interception (petition-ballot-link.spec.ts
 * pattern) plus a full-page axe scan of the results view.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SNIP = (s: string) => `⟪${s}⟫`;

const mockSuggestions = [
  {
    id: "bill-1",
    kind: "DIRECT",
    label: "Residential property insurance: wildfire risk mitigation",
    sublabel: "AB 1236 · 2025-2026",
  },
  {
    id: "bill-2",
    kind: "BILL",
    label: "FAIR Plan sustainability fund",
    sublabel: "SB 505 · 2025-2026",
  },
  {
    id: "prop-1",
    kind: "PROPOSITION",
    label: "Wildfire Response Bond Act",
    sublabel: "prop-12-2026",
  },
];

const mockSearchResult = {
  items: [
    {
      rank: 9.6,
      snippet: `requires premium discounts for ${SNIP("wildfire")}-hardened homes`,
      result: {
        __typename: "Bill",
        id: "bill-1",
        billNumber: "AB 1236",
        sessionYear: "2025-2026",
        measureTypeCode: "AB",
        title: "Residential property insurance: wildfire risk mitigation",
        authorName: "Asm. L. Rivera",
        status: "Active Bill - In Senate",
        lastAction: "Read second time.",
        lastActionDate: "2026-08-28",
        isActive: true,
        isDead: false,
      },
    },
    {
      rank: 3.7,
      snippet: `authorizes bonds for ${SNIP("wildfire")} prevention`,
      result: {
        __typename: "PropositionModel",
        id: "prop-1",
        externalId: "prop-12-2026",
        title: "Wildfire Response Bond Act",
        status: "PENDING",
        electionDate: "2026-11-03T00:00:00Z",
      },
    },
  ],
  total: 2,
  hasMore: false,
  billCount: 1,
  propositionCount: 1,
};

async function mockSearchGraphQL(page: import("@playwright/test").Page) {
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

    if (postData?.query?.includes("RegionSearchSuggest")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { regionSearchSuggest: mockSuggestions },
        }),
      });
    } else if (postData?.query?.includes("RegionSearch")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { regionSearch: mockSearchResult } }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
    }
  });
}

test.describe("Region search (#1154)", () => {
  test("header typeahead shows sections and navigates to a suggestion", async ({
    page,
  }) => {
    await mockSearchGraphQL(page);
    await page.goto("/region");

    const input = page.getByRole("combobox");
    await expect(input).toBeVisible();
    await input.fill("wildfire");

    const direct = page.getByRole("option", {
      name: /Residential property insurance/i,
    });
    await expect(direct).toBeVisible();
    await expect(page.getByText("Jump to bill")).toBeVisible();

    await direct.click();
    await expect(page).toHaveURL(/\/region\/bills\/bill-1/);
  });

  test("Enter routes to the results page with the query in the URL", async ({
    page,
  }) => {
    await mockSearchGraphQL(page);
    await page.goto("/region");

    const input = page.getByRole("combobox");
    await input.fill("wildfire");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/region\/search\?q=wildfire/);
    await expect(
      page.getByRole("heading", { name: /Search|Buscar/ }),
    ).toBeVisible();
  });

  test("results page renders mixed cards with highlighted snippets and facet counts", async ({
    page,
  }) => {
    await mockSearchGraphQL(page);
    await page.goto("/region/search?q=wildfire");

    await expect(page.getByText(/2 results for/)).toBeVisible();
    await expect(page.getByText("AB 1236")).toBeVisible();
    await expect(page.getByText("Wildfire Response Bond Act")).toBeVisible();
    // Snippet highlight renders as a real <mark>, not literal sentinels.
    await expect(page.locator("mark").first()).toHaveText("wildfire");
    await expect(page.getByText("⟪")).toHaveCount(0);
    // Facet counts from the response.
    await expect(page.getByRole("radio", { name: /All · 2/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Bills · 1/ })).toBeVisible();
  });

  test("results page has no axe violations", async ({ page }) => {
    await mockSearchGraphQL(page);
    await page.goto("/region/search?q=wildfire");
    await expect(page.getByText("AB 1236")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
