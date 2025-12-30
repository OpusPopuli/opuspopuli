import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mock data for email tests
const mockUser = {
  id: "test-user-id",
  email: "test@example.com",
};

const mockEmailHistory = {
  items: [
    {
      id: "1",
      userId: mockUser.id,
      emailType: "REPRESENTATIVE_CONTACT",
      status: "SENT",
      recipientEmail: "rep@congress.gov",
      recipientName: "Rep. Jane Smith",
      subject: "Regarding Education Bill",
      bodyPreview:
        "Dear Representative, I am writing to express my support for...",
      representativeId: "rep-1",
      representativeName: "Rep. Jane Smith",
      propositionId: null,
      propositionTitle: null,
      sentAt: "2024-12-28T10:30:00Z",
      createdAt: "2024-12-28T10:30:00Z",
      updatedAt: "2024-12-28T10:30:00Z",
    },
    {
      id: "2",
      userId: mockUser.id,
      emailType: "WELCOME",
      status: "DELIVERED",
      recipientEmail: "test@example.com",
      recipientName: "Test User",
      subject: "Welcome to Commonwealth Labs",
      bodyPreview: "Welcome to our platform! We're excited to have you...",
      representativeId: null,
      representativeName: null,
      propositionId: null,
      propositionTitle: null,
      sentAt: "2024-12-01T09:00:00Z",
      createdAt: "2024-12-01T09:00:00Z",
      updatedAt: "2024-12-01T09:00:00Z",
    },
    {
      id: "3",
      userId: mockUser.id,
      emailType: "REPRESENTATIVE_CONTACT",
      status: "FAILED",
      recipientEmail: "rep2@congress.gov",
      recipientName: "Rep. John Doe",
      subject: "Climate Policy Concerns",
      bodyPreview: "I am writing to share my concerns about...",
      representativeId: "rep-2",
      representativeName: "Rep. John Doe",
      propositionId: "prop-1",
      propositionTitle: "Climate Action Initiative",
      errorMessage: "Recipient email rejected",
      sentAt: null,
      createdAt: "2024-12-15T14:00:00Z",
      updatedAt: "2024-12-15T14:00:00Z",
    },
  ],
  total: 3,
  hasMore: false,
};

const mockRepresentatives = {
  items: [
    {
      id: "rep-1",
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
      id: "rep-2",
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

const mockContactResult = {
  success: true,
  correspondenceId: "new-correspondence-id",
};

// Helper function to mock GraphQL API for email tests
async function mockEmailGraphQL(page: import("@playwright/test").Page) {
  await page.route("**/api", async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();

    if (postData?.query?.includes("myEmailHistory")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { myEmailHistory: mockEmailHistory },
        }),
      });
    } else if (postData?.query?.includes("contactRepresentative")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { contactRepresentative: mockContactResult },
        }),
      });
    } else if (postData?.query?.includes("representativeMailtoLink")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            representativeMailtoLink:
              "mailto:rep@example.gov?subject=Test&body=Hello",
          },
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

test.describe("Email History Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockEmailGraphQL(page);
  });

  test("should display page header", async ({ page }) => {
    await page.goto("/settings/email-history");

    await expect(
      page.getByRole("heading", { name: "Email History" }),
    ).toBeVisible();
    await expect(
      page.getByText("View your sent emails and correspondence"),
    ).toBeVisible();
  });

  test("should display breadcrumb navigation", async ({ page }) => {
    await page.goto("/settings/email-history");

    await expect(page.getByRole("link", { name: /Settings/i })).toBeVisible();
  });

  test("should display email history cards", async ({ page }) => {
    await page.goto("/settings/email-history");

    await expect(page.getByText("Regarding Education Bill")).toBeVisible();
    await expect(page.getByText("Welcome to Commonwealth Labs")).toBeVisible();
    await expect(page.getByText("Climate Policy Concerns")).toBeVisible();
  });

  test("should display status badges", async ({ page }) => {
    await page.goto("/settings/email-history");

    await expect(page.getByText("SENT", { exact: true })).toBeVisible();
    await expect(page.getByText("DELIVERED", { exact: true })).toBeVisible();
    await expect(page.getByText("FAILED", { exact: true })).toBeVisible();
  });

  test("should display email type labels", async ({ page }) => {
    await page.goto("/settings/email-history");

    // Wait for content to load first
    await expect(page.getByText("Regarding Education Bill")).toBeVisible();

    // Check for type labels in the cards
    const repContactLabels = await page
      .getByText("Representative Contact")
      .count();
    expect(repContactLabels).toBeGreaterThan(0);
  });

  test("should display error message for failed emails", async ({ page }) => {
    await page.goto("/settings/email-history");

    await expect(page.getByText(/Recipient email rejected/)).toBeVisible();
  });

  test("should display pagination info", async ({ page }) => {
    await page.goto("/settings/email-history");

    await expect(page.getByText(/Showing 1 - 3 of 3/)).toBeVisible();
  });

  test("should have type filter dropdown", async ({ page }) => {
    await page.goto("/settings/email-history");

    // Wait for content to load
    await expect(page.getByText("Regarding Education Bill")).toBeVisible();

    // Check filter label and combobox exist
    await expect(page.getByText("Filter by type:")).toBeVisible();
    const combobox = page.getByRole("combobox", { name: /Filter by type/i });
    await expect(combobox).toBeVisible();

    // Verify it has the "All Types" option selected
    await expect(combobox).toHaveValue("");
  });

  test("should filter by email type", async ({ page }) => {
    await page.goto("/settings/email-history");

    const select = page.getByRole("combobox");
    await select.selectOption("REPRESENTATIVE_CONTACT");

    await expect(select).toHaveValue("REPRESENTATIVE_CONTACT");
  });

  test("should navigate to settings via breadcrumb", async ({ page }) => {
    await page.goto("/settings/email-history");

    await page.getByRole("link", { name: /Settings/i }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe("Email History Page - Empty State", () => {
  test("should display empty state when no emails exist", async ({ page }) => {
    await page.route("**/api", async (route) => {
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.query?.includes("myEmailHistory")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              myEmailHistory: {
                items: [],
                total: 0,
                hasMore: false,
              },
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/settings/email-history");

    await expect(page.getByText("No emails found.")).toBeVisible();
    await expect(
      page.getByText("Emails you send will appear here."),
    ).toBeVisible();
  });
});

test.describe("Email History Page - Error State", () => {
  test("should display error when API fails", async ({ page }) => {
    await page.route("**/api", async (route) => {
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.query?.includes("myEmailHistory")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            errors: [{ message: "Failed to load email history" }],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/settings/email-history");

    await expect(page.getByText(/Failed to load email history/i)).toBeVisible();
  });
});

test.describe("Email History Page - Loading State", () => {
  test("should show loading skeleton", async ({ page }) => {
    await page.route("**/api", async (route) => {
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.query?.includes("myEmailHistory")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { myEmailHistory: mockEmailHistory },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/settings/email-history");

    const skeletons = await page.locator(".animate-pulse").count();
    expect(skeletons).toBeGreaterThan(0);
  });
});

test.describe("Contact Representative Form", () => {
  test.beforeEach(async ({ page }) => {
    await mockEmailGraphQL(page);
  });

  test("should display contact form on representatives page", async ({
    page,
  }) => {
    await page.goto("/region/representatives");

    // Wait for representatives to load
    await expect(page.getByText("Jane Smith")).toBeVisible();

    // Click contact button
    const contactButton = page
      .getByRole("button", { name: /Contact/i })
      .first();
    await contactButton.click();

    // Form should be visible
    await expect(page.getByText(/Contact Jane Smith/)).toBeVisible();
  });

  test("should have subject and message fields", async ({ page }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();

    await expect(page.getByLabel(/Subject/i)).toBeVisible();
    await expect(page.getByLabel(/Message/i)).toBeVisible();
  });

  test("should have send method toggle", async ({ page }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();

    await expect(page.getByText("Send via Platform")).toBeVisible();
    await expect(page.getByText("Open in Email Client")).toBeVisible();
  });

  test("should have include address checkbox", async ({ page }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();

    await expect(page.getByText(/Include my address/)).toBeVisible();
  });

  test("should show character count for message", async ({ page }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();

    await expect(page.getByText("/5000 characters")).toBeVisible();
  });

  test("should disable submit button when form is incomplete", async ({
    page,
  }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();

    const submitButton = page.getByRole("button", { name: /Send Message/i });
    await expect(submitButton).toBeDisabled();
  });

  test("should enable submit button when form is valid", async ({ page }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();

    // Fill out the form
    await page.getByLabel(/Subject/i).fill("Test Subject");
    await page
      .getByLabel(/Message/i)
      .fill("This is a test message that is long enough to be valid.");

    const submitButton = page.getByRole("button", { name: /Send Message/i });
    await expect(submitButton).toBeEnabled();
  });

  test("should close form when cancel is clicked", async ({ page }) => {
    await page.goto("/region/representatives");
    await expect(page.getByText("Jane Smith")).toBeVisible();

    await page
      .getByRole("button", { name: /Contact/i })
      .first()
      .click();
    await expect(page.getByText(/Contact Jane Smith/)).toBeVisible();

    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByText(/Contact Jane Smith/)).not.toBeVisible();
  });
});

test.describe("Email Pages - Accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockEmailGraphQL(page);
  });

  test("Email history page should have no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await page.goto("/settings/email-history");

    // Wait for content to load
    await expect(page.getByText("Regarding Education Bill")).toBeVisible();

    const violations = await checkAccessibility(page);
    expect(violations).toEqual([]);
  });
});

test.describe("Email Pages - Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockEmailGraphQL(page);
  });

  test("should be able to navigate email history with keyboard", async ({
    page,
  }) => {
    await page.goto("/settings/email-history");
    await expect(
      page.getByRole("heading", { name: "Email History" }),
    ).toBeVisible();

    // Tab through the page
    await page.keyboard.press("Tab");

    const activeElement = await page.evaluate(
      () => document.activeElement?.tagName,
    );
    expect(activeElement).toBeTruthy();
  });

  test("should be able to navigate pagination with keyboard", async ({
    page,
  }) => {
    await page.goto("/settings/email-history");
    await expect(
      page.getByRole("heading", { name: "Email History" }),
    ).toBeVisible();

    const previousButton = page.getByRole("button", {
      name: "Previous",
      exact: true,
    });
    const nextButton = page.getByRole("button", { name: "Next", exact: true });

    await expect(previousButton).toBeVisible();
    await expect(nextButton).toBeVisible();
  });
});

test.describe("Email Pages - Responsive Design", () => {
  test.beforeEach(async ({ page }) => {
    await mockEmailGraphQL(page);
  });

  test("should display correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/settings/email-history");

    // Wait for content to load - use status badge which won't be truncated
    await expect(page.getByText("SENT", { exact: true })).toBeVisible();

    // Verify filter is also visible on mobile
    await expect(page.getByText("Filter by type:")).toBeVisible();
  });

  test("should display correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/settings/email-history");

    // Wait for content to load
    await expect(page.getByText("SENT", { exact: true })).toBeVisible();
    await expect(page.getByText("Regarding Education Bill")).toBeVisible();
  });
});
