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

    // The same summary exists in a visually-hidden live region, so scope
    // to the visible copy.
    await expect(
      page.getByText(/2 results for/).and(page.locator("[aria-hidden=true]")),
    ).toBeVisible();
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

/**
 * Regressions found by the #1154 review. Each of these shipped in the
 * first cut of the feature and passed the unit suite; they are kept as
 * e2e because all three are behaviours only a real browser exhibits.
 */
test.describe("Region search — review regressions (#1154)", () => {
  const echoSuggestions = [
    {
      id: "bill-1",
      kind: "DIRECT",
      label: "Wildfire risk mitigation",
      sublabel: "AB 1236 · 2025-2026",
    },
    {
      id: "prop-1",
      kind: "PROPOSITION",
      label: "Wildfire Response Bond Act",
      sublabel: "prop-12",
    },
  ];

  /** Echoes the query into the title so a reverted URL is observable. */
  function echoResults(q: string) {
    return {
      items: [
        {
          rank: 9.6,
          snippet: `matched ${SNIP(q)} here`,
          result: {
            __typename: "Bill",
            id: "bill-1",
            billNumber: `AB ${q.length}`,
            sessionYear: "2025-2026",
            measureTypeCode: "AB",
            title: `Result for ${q}`,
            authorName: null,
            status: null,
            lastAction: null,
            lastActionDate: null,
            isActive: true,
            isDead: false,
          },
        },
      ],
      total: 1,
      hasMore: false,
      // Deliberately larger than the page: facet counts are corpus-wide.
      billCount: 40,
      propositionCount: 5,
    };
  }

  async function mockEcho(page: import("@playwright/test").Page) {
    await page.addInitScript(() =>
      localStorage.setItem(
        "auth_user",
        JSON.stringify({ id: "u", email: "t@e.com", roles: ["user"] }),
      ),
    );
    await page.route("**/api", async (route) => {
      const pd = route.request().postDataJSON();
      const q = pd?.variables?.query ?? "";
      let body: Record<string, unknown> = { data: {} };
      if (pd?.query?.includes("RegionSearchSuggest")) {
        body = { data: { regionSearchSuggest: echoSuggestions } };
      } else if (pd?.query?.includes("RegionSearch")) {
        body = { data: { regionSearch: echoResults(q) } };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }

  test("a header search run from the results page is not reverted by the stale input", async ({
    page,
  }) => {
    await mockEcho(page);
    await page.goto("/region/search?q=taxes");
    await expect(page.getByText("Result for taxes")).toBeVisible();

    const header = page.getByRole("combobox");
    await header.fill("housing");
    await header.press("Enter");
    await expect(page).toHaveURL(/q=housing/);

    // The page does not remount on a same-route push, so the old local
    // input used to win the next debounce tick and replace the URL back.
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/q=housing/);
    await expect(page.getByText("Result for housing")).toBeVisible();
  });

  test("arrowing past a shrinking suggestion list does not throw on Enter", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await mockEcho(page);
    await page.goto("/region");
    const header = page.getByRole("combobox");
    await header.fill("wildfire");
    await expect(page.getByRole("option").first()).toBeVisible();

    for (let i = 0; i < 12; i++) await header.press("ArrowDown");
    await header.press("Enter");
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });

  test("facet counts stay corpus-wide while a type filter is active", async ({
    page,
  }) => {
    await mockEcho(page);
    await page.goto("/region/search?q=wildfire&type=PROPOSITION");

    // Counting only the included arm rendered "Bills · 0" while 40 matched.
    await expect(page.getByRole("radio", { name: /Bills · 40/ })).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /Propositions · 5/ }),
    ).toBeVisible();
  });
});
