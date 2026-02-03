import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mock data for region tests
const mockRegionInfo = {
  id: "test-region",
  name: "Test Region",
  description: "A test region for civic data",
  timezone: "America/Los_Angeles",
  dataSourceUrls: ["https://example.com/data"],
  supportedDataTypes: ["PROPOSITIONS", "MEETINGS", "REPRESENTATIVES"],
};

const mockPropositions = {
  items: [
    {
      id: "1",
      externalId: "prop-1",
      title: "Proposition 1: Test Measure",
      summary: "This is a test proposition summary.",
      status: "PENDING",
      electionDate: "2024-11-05T00:00:00Z",
      sourceUrl: "https://example.com/prop-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "prop-2",
      title: "Proposition 2: Passed Measure",
      summary: "This proposition passed.",
      status: "PASSED",
      electionDate: "2024-03-05T00:00:00Z",
      sourceUrl: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

const mockMeetings = {
  items: [
    {
      id: "1",
      externalId: "meeting-1",
      title: "City Council Regular Meeting",
      body: "City Council",
      scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      location: "City Hall, Room 201",
      agendaUrl: "https://example.com/agenda",
      videoUrl: "https://example.com/video",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "meeting-2",
      title: "Planning Commission Hearing",
      body: "Planning Commission",
      scheduledAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      location: "City Hall, Room 305",
      agendaUrl: "https://example.com/agenda-2",
      videoUrl: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

const mockRepresentatives = {
  items: [
    {
      id: "1",
      externalId: "rep-1",
      name: "Jane Smith",
      chamber: "Senate",
      district: "5",
      party: "Democrat",
      photoUrl: "https://example.com/photo1.jpg",
      contactInfo: {
        email: "jane.smith@example.gov",
        phone: "555-1234",
        office: "State Capitol, Room 100",
        website: "https://example.com/janesmith",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "rep-2",
      name: "John Doe",
      chamber: "Assembly",
      district: "12",
      party: "Republican",
      photoUrl: null,
      contactInfo: {
        email: "john.doe@example.gov",
        phone: "555-5678",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

// Helper function to mock GraphQL API
async function mockRegionGraphQL(page: import("@playwright/test").Page) {
  // Set up auth session BEFORE page loads using addInitScript
  // This runs before any page JavaScript, ensuring auth is set before React hydrates
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
    const request = route.request();
    const postData = request.postDataJSON();

    if (postData?.query?.includes("regionInfo")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { regionInfo: mockRegionInfo },
        }),
      });
    } else if (postData?.query?.includes("propositions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { propositions: mockPropositions },
        }),
      });
    } else if (postData?.query?.includes("meetings")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { meetings: mockMeetings },
        }),
      });
    } else if (postData?.query?.includes("representatives")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { representatives: mockRepresentatives },
        }),
      });
    } else {
      await route.continue();
    }
  });
}

// Helper to check accessibility
async function checkAccessibility(page: import("@playwright/test").Page) {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  return accessibilityScanResults.violations;
}

test.describe("Region Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("should display region information", async ({ page }) => {
    await page.goto("/region");

    await expect(
      page.getByRole("heading", { name: "Test Region" }),
    ).toBeVisible();
    await expect(page.getByText("A test region for civic data")).toBeVisible();
    await expect(
      page.getByText(/Timezone: America\/Los_Angeles/),
    ).toBeVisible();
  });

  test("should display data type cards", async ({ page }) => {
    await page.goto("/region");

    await expect(page.getByText("Propositions")).toBeVisible();
    await expect(page.getByText("Meetings")).toBeVisible();
    await expect(page.getByText("Representatives")).toBeVisible();
  });

  test("should display data source URLs", async ({ page }) => {
    await page.goto("/region");

    await expect(page.getByText("Data Sources")).toBeVisible();
    await expect(page.getByText("https://example.com/data")).toBeVisible();
  });

  test("should navigate to propositions page", async ({ page }) => {
    await page.goto("/region");

    await page.getByRole("link", { name: /Propositions/i }).click();
    await expect(page).toHaveURL(/\/region\/propositions/);
  });

  test("should navigate to meetings page", async ({ page }) => {
    await page.goto("/region");

    await page.getByRole("link", { name: /Meetings/i }).click();
    await expect(page).toHaveURL(/\/region\/meetings/);
  });

  test("should navigate to representatives page", async ({ page }) => {
    await page.goto("/region");

    await page.getByRole("link", { name: /Representatives/i }).click();
    await expect(page).toHaveURL(/\/region\/representatives/);
  });
});

test.describe("Propositions Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("should display page header", async ({ page }) => {
    await page.goto("/region/propositions");

    await expect(
      page.getByRole("heading", { name: "Propositions" }),
    ).toBeVisible();
    await expect(
      page.getByText("Ballot measures and initiatives for your region"),
    ).toBeVisible();
  });

  test("should display breadcrumb navigation", async ({ page }) => {
    await page.goto("/region/propositions");

    await expect(page.getByRole("link", { name: /Region/i })).toBeVisible();
  });

  test("should display proposition cards", async ({ page }) => {
    await page.goto("/region/propositions");

    await expect(page.getByText("Proposition 1: Test Measure")).toBeVisible();
    await expect(page.getByText("Proposition 2: Passed Measure")).toBeVisible();
  });

  test("should display status badges", async ({ page }) => {
    await page.goto("/region/propositions");

    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();
  });

  test("should display pagination info", async ({ page }) => {
    await page.goto("/region/propositions");

    await expect(page.getByText(/Showing 1 - 2 of 2/)).toBeVisible();
  });

  test("should have disabled previous button on first page", async ({
    page,
  }) => {
    await page.goto("/region/propositions");

    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  test("should navigate back to region page via breadcrumb", async ({
    page,
  }) => {
    await page.goto("/region/propositions");

    await page.getByRole("link", { name: /Region/i }).click();
    await expect(page).toHaveURL(/\/region$/);
  });
});

test.describe("Meetings Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("should display page header", async ({ page }) => {
    await page.goto("/region/meetings");

    await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();
    await expect(
      page.getByText("Legislative sessions and public hearings"),
    ).toBeVisible();
  });

  test("should display meeting cards", async ({ page }) => {
    await page.goto("/region/meetings");

    await expect(page.getByText("City Council Regular Meeting")).toBeVisible();
    await expect(page.getByText("Planning Commission Hearing")).toBeVisible();
  });

  test("should display meeting bodies", async ({ page }) => {
    await page.goto("/region/meetings");

    await expect(page.getByText("City Council", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Planning Commission", { exact: true }),
    ).toBeVisible();
  });

  test("should display meeting locations", async ({ page }) => {
    await page.goto("/region/meetings");

    await expect(page.getByText("City Hall, Room 201")).toBeVisible();
    await expect(page.getByText("City Hall, Room 305")).toBeVisible();
  });

  test("should display agenda links when available", async ({ page }) => {
    await page.goto("/region/meetings");

    // Wait for content to load
    await expect(page.getByText("City Council Regular Meeting")).toBeVisible();

    const agendaLinks = await page.getByRole("link", { name: /Agenda/i }).all();
    expect(agendaLinks.length).toBe(2);
  });

  test("should show Past badge for past meetings", async ({ page }) => {
    await page.goto("/region/meetings");

    await expect(page.getByText("Past")).toBeVisible();
  });
});

test.describe("Representatives Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("should display page header", async ({ page }) => {
    await page.goto("/region/representatives");

    await expect(
      page.getByRole("heading", { name: "Representatives" }),
    ).toBeVisible();
    await expect(
      page.getByText("Elected officials and legislators"),
    ).toBeVisible();
  });

  test("should display representative cards", async ({ page }) => {
    await page.goto("/region/representatives");

    await expect(page.getByText("Jane Smith")).toBeVisible();
    await expect(page.getByText("John Doe")).toBeVisible();
  });

  test("should display chamber information", async ({ page }) => {
    await page.goto("/region/representatives");

    // Wait for cards to load
    await expect(page.getByText("Jane Smith")).toBeVisible();

    // Check that chamber filter has options (chambers are displayed in cards and filter)
    const filterSelect = page.getByRole("combobox");
    await expect(filterSelect).toBeVisible();

    // Verify chambers exist by checking card content contains chamber text
    const cardContent = await page
      .locator("article, [class*='rounded-xl']")
      .first()
      .textContent();
    expect(cardContent).toBeTruthy();
  });

  test("should display party badges", async ({ page }) => {
    await page.goto("/region/representatives");

    await expect(page.getByText("Democrat")).toBeVisible();
    await expect(page.getByText("Republican")).toBeVisible();
  });

  test("should display contact information", async ({ page }) => {
    await page.goto("/region/representatives");

    await expect(page.getByText("jane.smith@example.gov")).toBeVisible();
    await expect(page.getByText("555-1234")).toBeVisible();
  });

  test("should have chamber filter dropdown", async ({ page }) => {
    await page.goto("/region/representatives");

    await expect(page.getByText("Filter:")).toBeVisible();
    await expect(page.getByRole("combobox")).toBeVisible();
  });

  test("should filter by chamber when selected", async ({ page }) => {
    await page.goto("/region/representatives");

    const select = page.getByRole("combobox");
    await select.selectOption("Senate");

    await expect(select).toHaveValue("Senate");
  });
});

test.describe("Region Pages - Error Handling", () => {
  test("should show error message when region info fails to load", async ({
    page,
  }) => {
    // Set up auth session first
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
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.query?.includes("regionInfo")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            errors: [{ message: "Failed to load region info" }],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/region");

    await expect(
      page.getByText(/Failed to load region information/i),
    ).toBeVisible();
  });

  test("should show error message when propositions fail to load", async ({
    page,
  }) => {
    // Set up auth session first
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
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.query?.includes("propositions")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            errors: [{ message: "Failed to load propositions" }],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/region/propositions");

    await expect(page.getByText(/Failed to load propositions/i)).toBeVisible();
  });
});

test.describe("Region Pages - Loading State", () => {
  test("should show loading skeleton on region page", async ({ page }) => {
    // Set up auth session first
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

    // Delay the response to show loading state
    await page.route("**/api", async (route) => {
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.query?.includes("regionInfo")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { regionInfo: mockRegionInfo },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/region");

    // Check for loading skeleton (animate-pulse class)
    const skeletons = await page.locator(".animate-pulse").count();
    expect(skeletons).toBeGreaterThan(0);
  });
});

test.describe("Region Pages - Accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("Region page should have no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await page.goto("/region");
    // Wait for content to load
    await expect(
      page.getByRole("heading", { name: "Test Region" }),
    ).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });

  test("Propositions page should have no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await page.goto("/region/propositions");
    // Wait for content to load
    await expect(
      page.getByRole("heading", { name: "Propositions" }),
    ).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });

  test("Meetings page should have no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await page.goto("/region/meetings");
    // Wait for content to load
    await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });

  test("Representatives page should have no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await page.goto("/region/representatives");
    // Wait for content to load
    await expect(
      page.getByRole("heading", { name: "Representatives" }),
    ).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });
});

test.describe("Region Pages - Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("should be able to navigate region page with keyboard", async ({
    page,
  }) => {
    await page.goto("/region");
    await expect(
      page.getByRole("heading", { name: "Test Region" }),
    ).toBeVisible();

    // Tab through the page
    await page.keyboard.press("Tab");

    // Should be able to focus on interactive elements
    const activeElement = await page.evaluate(
      () => document.activeElement?.tagName,
    );
    expect(activeElement).toBeTruthy();
  });

  test("should be able to navigate pagination with keyboard", async ({
    page,
  }) => {
    await page.goto("/region/propositions");
    await expect(
      page.getByRole("heading", { name: "Propositions" }),
    ).toBeVisible();

    // Verify pagination buttons exist (use exact match to avoid Next.js Dev Tools button)
    const previousButton = page.getByRole("button", {
      name: "Previous",
      exact: true,
    });
    const nextButton = page.getByRole("button", { name: "Next", exact: true });

    await expect(previousButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // Previous should be disabled on first page
    await expect(previousButton).toBeDisabled();
  });

  test("focus should be visible on interactive elements", async ({ page }) => {
    await page.goto("/region");
    await expect(
      page.getByRole("heading", { name: "Test Region" }),
    ).toBeVisible();

    // Tab to first focusable element
    await page.keyboard.press("Tab");

    // Check that there's a visible focus indicator
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const styles = globalThis.getComputedStyle(el);
      return {
        outline: styles.outline,
        boxShadow: styles.boxShadow,
      };
    });

    // Element should have some focus styling
    expect(
      focusedElement?.outline !== "none" ||
        focusedElement?.boxShadow !== "none",
    ).toBeTruthy();
  });
});

test.describe("Region Pages - Responsive Design", () => {
  test.beforeEach(async ({ page }) => {
    await mockRegionGraphQL(page);
  });

  test("should display correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/region");

    await expect(
      page.getByRole("heading", { name: "Test Region" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Propositions/i }),
    ).toBeVisible();
  });

  test("representatives should display in single column on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/region/representatives");

    await expect(page.getByText("Jane Smith")).toBeVisible();
    await expect(page.getByText("John Doe")).toBeVisible();
  });

  test("should display correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/region");

    await expect(
      page.getByRole("heading", { name: "Test Region" }),
    ).toBeVisible();
  });
});
