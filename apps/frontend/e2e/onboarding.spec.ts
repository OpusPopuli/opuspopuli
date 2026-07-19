/**
 * Onboarding Flow E2E Tests (#758)
 *
 * Tests for the first-time user onboarding experience:
 * Welcome → Explore → Scan → Analyze → Track → Address → Topics →
 * LifeContext → Veteran → redirect to /region
 *
 * Marketing steps (0–4) use the global Next button. Data-collection
 * steps (5–8) own their own primary action — "Save & Continue" /
 * "Get Started" — and offer per-step "Skip this".
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupAuthSession,
  mockGraphQL,
  checkAccessibility,
  viewports,
} from "./utils/test-helpers";

// The onboarding page reads completion from the server (#758): the
// `myProfile.onboardingCompletedAt` flag is authoritative, and localStorage
// is only a fallback for when that query has not resolved. So the session
// helpers mock MyProfile to drive the two cases — NULL = never onboarded
// (show the flow), a timestamp = already onboarded (redirect away).
const profileBase = {
  __typename: "UserProfileModel",
  id: "p-1",
  userId: "user-123",
};

async function setupNewUserSession(page: Page) {
  await setupAuthSession(page);
  await mockGraphQL(page, {
    MyProfile: { myProfile: { ...profileBase, onboardingCompletedAt: null } },
  });
  await page.addInitScript(() => {
    localStorage.removeItem("opuspopuli_onboarding_completed");
  });
}

async function setupReturningUserSession(page: Page) {
  await setupAuthSession(page);
  await mockGraphQL(page, {
    MyProfile: {
      myProfile: {
        ...profileBase,
        onboardingCompletedAt: "2026-07-18T00:00:00.000Z",
      },
    },
  });
  await page.addInitScript(() => {
    localStorage.setItem("opuspopuli_onboarding_completed", "true");
  });
}

async function advanceMarketingSteps(page: Page) {
  // 4 clicks of "Next" walks Welcome → Explore → Scan → Analyze → Track.
  // After these clicks the user is on the Track step (last marketing).
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
}

async function advanceToAddressStep(page: Page) {
  await advanceMarketingSteps(page);
  // Final marketing step's Next opens the first data step.
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

test.describe("Onboarding Flow", () => {
  test("should display welcome step for new user", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    await expect(page.getByText(/civic engagement hub/i)).toBeVisible();
  });

  test("should navigate through marketing steps to address step", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByText("Explore Your Region")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Scan Petitions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByText("Instant Analysis")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByText("Track Progress")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // First data step
    await expect(
      page.getByRole("heading", { name: "Where do you live?" }),
    ).toBeVisible();
  });

  test("should complete onboarding via per-step skip and redirect to /region", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await advanceToAddressStep(page);

    // Skip each data step individually (#758 acceptance: each field skippable).
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "What matters to you?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "A bit about your day" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "One sensitive question" }),
    ).toBeVisible();

    // Veteran step's primary action is "Save & Continue" — advances
    // into the mandatory commitments-acknowledgement step (#754).
    await page.getByRole("button", { name: /save & continue/i }).click();

    // Commitments step is mandatory: no skip, no back; must check the
    // box then click Continue to redirect to the briefing.
    await expect(
      page.getByRole("heading", { name: /acknowledge these commitments/i }),
    ).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/me\/briefing/);
  });

  test("global Skip aborts entire flow from any step", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    // The header "Skip" button is the global abort; data steps render
    // "Skip this" for the per-field skip.
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page).toHaveURL(/\/me\/briefing/);
  });

  test("should navigate back to previous step", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Explore Your Region")).toBeVisible();

    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
  });

  test("back button should be disabled on first step", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    const backButton = page.getByRole("button", { name: /back/i });
    await expect(backButton).toBeDisabled();
  });

  test("should persist completion in localStorage on skip", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    const before = await page.evaluate(() =>
      localStorage.getItem("opuspopuli_onboarding_completed"),
    );
    expect(before).toBeNull();

    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page).toHaveURL(/\/me\/briefing/);

    const completed = await page.evaluate(() =>
      localStorage.getItem("opuspopuli_onboarding_completed"),
    );
    expect(completed).toBe("true");
  });
});

test.describe("Onboarding - Data steps", () => {
  test("Address step: fills in fields and advances on Save & Continue", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);

    await page.getByPlaceholder("Street address").fill("100 Main St");
    await page.getByPlaceholder("City").fill("Sacramento");
    await page.getByLabel("State").selectOption("CA");
    await page.getByPlaceholder("ZIP code").fill("95814");

    await page.getByRole("button", { name: /save & continue/i }).click();

    await expect(
      page.getByRole("heading", { name: "What matters to you?" }),
    ).toBeVisible();
  });

  // Idempotent-retry behavior (pre-fill from `myAddresses` + UPDATE
  // instead of CREATE on resubmit) is hard to exercise in Playwright
  // because the catch-all GraphQL mock interacts with Apollo's
  // persisted cache and prevents the test mock from intercepting the
  // initial query. The contract is unit-tested in
  // `signal-profile.service.spec.ts` and we verify the address path
  // manually against the real UAT backend.

  test("Address step: partial fill shows validation error", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);

    await page.getByPlaceholder("City").fill("Sacramento");
    await page.getByRole("button", { name: /save & continue/i }).click();

    // Next.js renders its own `__next-route-announcer__` with role=alert,
    // so scope to the step's error text.
    await expect(
      page.getByText(/please fill in all four fields/i),
    ).toBeVisible();
  });

  test("Topics step: selecting chips advances on Save & Continue", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await page.getByRole("button", { name: "Skip this" }).click();

    await expect(
      page.getByRole("heading", { name: "What matters to you?" }),
    ).toBeVisible();

    await page.getByText("Housing & rent").click();
    await page.getByText("Healthcare").click();
    await page.getByRole("button", { name: /save & continue/i }).click();

    await expect(
      page.getByRole("heading", { name: "A bit about your day" }),
    ).toBeVisible();
  });

  test("Topics step: caps selection at 3 and blocks further picks", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await page.getByRole("button", { name: "Skip this" }).click();

    await expect(
      page.getByRole("heading", { name: "What matters to you?" }),
    ).toBeVisible();

    // Pick three.
    await page.getByText("Housing & rent").click();
    await page.getByText("Healthcare").click();
    await page.getByText("Education").click();
    await expect(page.getByText("3 of 3 selected")).toBeVisible();

    // A fourth click does nothing — the chip stays unchecked.
    const fourth = page.getByRole("checkbox", { name: "Immigration" });
    await expect(fourth).toBeDisabled();
    await expect(fourth).not.toBeChecked();
  });

  test("Veteran step: no-fields toggle disables the veteran chip", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();

    await expect(
      page.getByRole("heading", { name: "One sensitive question" }),
    ).toBeVisible();

    const veteranCheckbox = page.getByRole("checkbox", {
      name: "I'm a veteran or active-duty",
    });
    await expect(veteranCheckbox).toBeEnabled();

    const noFieldsCheckbox = page.getByRole("checkbox", {
      name: /never store sensitive fields/i,
    });
    await noFieldsCheckbox.check();
    await expect(veteranCheckbox).toBeDisabled();
  });
});

test.describe("Onboarding - Language", () => {
  test("Welcome step: switching language updates UI", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    // The radio input is sr-only; click the wrapping label instead so
    // Playwright doesn't trip over the label intercepting pointer events.
    await page
      .locator("label")
      .filter({ has: page.getByRole("radio", { name: "Español" }) })
      .click();

    await expect(page.getByText("Bienvenido a Opus Populi")).toBeVisible();
  });
});

test.describe("Onboarding - Returning User", () => {
  test("should redirect completed user to /region", async ({ page }) => {
    await setupReturningUserSession(page);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/me\/briefing/);
  });
});

test.describe("Onboarding - Unauthenticated", () => {
  test("should redirect to /login when not authenticated", async ({ page }) => {
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
    await expect(
      page.getByRole("button", { name: "Skip", exact: true }),
    ).toBeVisible();
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

test.describe("Onboarding - Accessibility (WCAG 2.2 AA)", () => {
  test("welcome step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await expect(page.getByText("Welcome to Opus Populi")).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("address step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await expect(
      page.getByRole("heading", { name: "Where do you live?" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("topics step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "What matters to you?" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("life context step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "A bit about your day" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("veteran step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToAddressStep(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "One sensitive question" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });
});
