/**
 * Onboarding Flow E2E Tests (#758, #1110)
 *
 * Your county -> What it takes -> What you watch -> One sensitive question ->
 * What to expect -> Commitments.
 *
 * Every step owns its own primary action; there is no global Next. The header
 * "Skip for now" aborts the whole flow, and data steps offer their own
 * "Skip this". The commitments step (#754) offers neither: it is mandatory.
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

// The county step's skip offers a real alternative rather than a bare "Skip
// this", so it has its own label.
const SKIP_COUNTY = "Skip and show me California instead";

/** Past the county form and the threshold screen, into the topics step. */
async function advanceToTopics(page: Page) {
  await page.getByRole("button", { name: SKIP_COUNTY }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

test.describe("Onboarding Flow", () => {
  test("opens on the county, not on a welcome screen", async ({ page }) => {
    // The four product slides that used to come first sold a reader who had
    // already clicked Get started. The address is the only thing the product
    // cannot proceed without, so it leads.
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await expect(
      page.getByRole("heading", { name: "Which county is yours?" }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Street address")).toBeVisible();
  });

  test("names every step in the progress rail", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    const rail = page.getByRole("list", { name: "Setup progress" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("listitem")).toHaveCount(6);
    await expect(rail.getByRole("listitem").first()).toHaveText(/Your county/);
  });

  test("offers the language choice before anything asks to be read", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    // The radio input is sr-only; click the wrapping label so Playwright does
    // not trip over the label intercepting pointer events.
    await page
      .locator("label")
      .filter({ has: page.getByRole("radio", { name: "Español" }) })
      .click();

    await expect(
      page.getByRole("heading", { name: "¿Cuál es tu condado?" }),
    ).toBeVisible();
  });

  test("carries no global Next button", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);
  });

  test("walks the whole flow to the briefing", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await page.getByRole("button", { name: SKIP_COUNTY }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "What are you actually watching?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip this" }).click();

    await expect(
      page.getByRole("heading", { name: "One sensitive question." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip this" }).click();

    await expect(
      page.getByRole("heading", { name: "What you will actually get." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Mandatory: no skip, no back, must acknowledge (#754).
    await expect(
      page.getByRole("heading", { name: /acknowledge these commitments/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Skip for now" }),
    ).toHaveCount(0);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/me\/briefing/);
  });

  test("global Skip aborts the entire flow", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/me\/briefing/);
  });

  test("back button is disabled on the first step", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  test("persists completion in localStorage on skip", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    const before = await page.evaluate(() =>
      localStorage.getItem("opuspopuli_onboarding_completed"),
    );
    expect(before).toBeNull();

    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/me\/briefing/);

    const completed = await page.evaluate(() =>
      localStorage.getItem("opuspopuli_onboarding_completed"),
    );
    expect(completed).toBe("true");
  });
});

test.describe("Onboarding - Data steps", () => {
  test("County step: fills the address and advances", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await page.getByPlaceholder("Street address").fill("100 Main St");
    await page.getByPlaceholder("City").fill("Sacramento");
    await page.getByLabel("State").selectOption("CA");
    await page.getByPlaceholder("ZIP").fill("95814");

    await page.getByRole("button", { name: /save and continue/i }).click();
    await expect(page.getByText("Step 2 of 6")).toBeVisible();
  });

  // Idempotent-retry behaviour (pre-fill from `myAddresses` + UPDATE instead
  // of CREATE on resubmit) is hard to exercise in Playwright because the
  // catch-all GraphQL mock interacts with Apollo's persisted cache and
  // prevents the test mock from intercepting the initial query. The contract
  // is unit-tested in `signal-profile.service.spec.ts` and we verify the
  // address path manually against the real UAT backend.

  test("County step: partial fill shows a validation error", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");

    await page.getByPlaceholder("City").fill("Sacramento");
    await page.getByRole("button", { name: /save and continue/i }).click();

    // Next.js renders its own `__next-route-announcer__` with role=alert, so
    // scope to the step's error text.
    await expect(page.getByText(/fill in every field/i)).toBeVisible();
  });

  test("Threshold step: routes back to the form to supply an address", async ({
    page,
  }) => {
    // With the address skipped there is no county to correct, so the same
    // control is an invitation to supply one rather than a correction to a
    // claim never made.
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await page.getByRole("button", { name: SKIP_COUNTY }).click();

    await expect(
      page.getByRole("button", { name: "That is the wrong county" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Let me enter my address" }).click();
    await expect(
      page.getByRole("heading", { name: "Which county is yours?" }),
    ).toBeVisible();
  });

  test("Topics step: selecting chips advances", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);

    await page.getByText("Housing and rent").click();
    await page.getByText("Healthcare").click();
    await page.getByRole("button", { name: /save and continue/i }).click();

    await expect(
      page.getByRole("heading", { name: "One sensitive question." }),
    ).toBeVisible();
  });

  test("Topics step: caps selection at 3", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);

    await page.getByText("Housing and rent").click();
    await page.getByText("Healthcare").click();
    await page.getByText("Education").click();
    await expect(page.getByText("3 of 3 selected")).toBeVisible();

    const fourth = page.getByRole("checkbox", { name: "Immigration" });
    await expect(fourth).toBeDisabled();
    await expect(fourth).not.toBeChecked();
  });

  test("Topics step: life context is optional and collapsed", async ({
    page,
  }) => {
    // It asks for more than the topics do, so a reader who does not want to
    // answer should see that without opening it.
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);

    const summary = page.getByText("Anything about your situation?");
    await expect(summary).toBeVisible();
    await expect(page.getByText("I rent")).toBeHidden();

    await summary.click();
    await expect(page.getByText("I rent")).toBeVisible();
  });

  test("Veteran step: no-fields toggle disables the veteran chip", async ({
    page,
  }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);
    await page.getByRole("button", { name: "Skip this" }).click();

    const veteranCheckbox = page.getByRole("checkbox", {
      name: "I'm a veteran or active-duty",
    });
    await expect(veteranCheckbox).toBeEnabled();

    await page
      .getByRole("checkbox", { name: /never store sensitive fields/i })
      .check();
    await expect(veteranCheckbox).toBeDisabled();
  });

  test("Expectations step: says what is not built yet", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();

    await expect(
      page.getByRole("heading", { name: "What you will actually get." }),
    ).toBeVisible();
    await expect(page.getByText("Building")).toHaveCount(2);
  });
});

test.describe("Onboarding - Returning User", () => {
  test("redirects a completed user to the briefing", async ({ page }) => {
    await setupReturningUserSession(page);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/me\/briefing/);
  });
});

test.describe("Onboarding - Unauthenticated", () => {
  test("redirects to /login when not authenticated", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Onboarding - Responsive Design", () => {
  test("displays correctly on mobile", async ({ page }) => {
    await setupNewUserSession(page);
    await page.setViewportSize(viewports.mobile);
    await page.goto("/onboarding");

    await expect(
      page.getByRole("heading", { name: "Which county is yours?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Skip for now" }),
    ).toBeVisible();
  });

  test("displays correctly on tablet", async ({ page }) => {
    await setupNewUserSession(page);
    await page.setViewportSize(viewports.tablet);
    await page.goto("/onboarding");

    await expect(
      page.getByRole("heading", { name: "Which county is yours?" }),
    ).toBeVisible();
  });
});

test.describe("Onboarding - Accessibility (WCAG 2.2 AA)", () => {
  test("county step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: "Which county is yours?" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("threshold step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await page.getByRole("button", { name: SKIP_COUNTY }).click();
    await expect(
      page.getByRole("button", { name: "Let me enter my address" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("topics step has no violations, opened and closed", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);
    await expect(
      page.getByRole("heading", { name: "What are you actually watching?" }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);

    await page.getByText("Anything about your situation?").click();
    await expect(page.getByText("I rent")).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("veteran step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "One sensitive question." }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("expectations step has no violations", async ({ page }) => {
    await setupNewUserSession(page);
    await page.goto("/onboarding");
    await advanceToTopics(page);
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();
    await expect(
      page.getByRole("heading", { name: "What you will actually get." }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });
});
