/**
 * Model-of-me page E2E (#752).
 *
 * Exercises the page-level flow with the catch-all GraphQL mock so
 * the surface stays decoupled from the UAT backend. Per-field edit
 * persistence is covered by the unit + service spec; this suite
 * focuses on what only the browser can verify: rendering, nav,
 * WCAG, and the no-fields-mode interactive contract.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupAuthSession,
  checkAccessibility,
  viewports,
} from "./utils/test-helpers";

async function setupAuthed(page: Page) {
  await setupAuthSession(page);
}

interface ProfileSeed {
  readonly signal?: Record<string, unknown>;
  readonly sensitive?: Record<string, unknown>;
}

interface MutationLog {
  readonly updateSignalCalls: Record<string, unknown>[];
  readonly updateSensitiveCalls: Record<string, unknown>[];
  readonly noFieldsCalls: boolean[];
}

/**
 * Routes MySignalProfile / MySensitiveProfile / their update mutations
 * and the no-fields toggle to stateful in-memory fixtures so we can
 * exercise the read → edit → save → re-render cycle the AC calls out.
 * Registered AFTER setupAuthSession so this handler wins via
 * Playwright's LIFO route ordering.
 */
async function seedProfile(
  page: Page,
  initial: ProfileSeed,
): Promise<MutationLog> {
  const log: MutationLog = {
    updateSignalCalls: [],
    updateSensitiveCalls: [],
    noFieldsCalls: [],
  };
  let signal: Record<string, unknown> = {
    __typename: "SignalProfile",
    id: "sp-1",
    userId: "test-user-id",
    housingTenure: null,
    buildingType: null,
    taxExposure: [],
    housingFlags: [],
    childrenAgeBands: [],
    hasEldercareDependents: null,
    multigenerational: null,
    hasPets: null,
    partnerStatus: null,
    employmentStatus: null,
    industry: null,
    occupationCategory: null,
    employerSizeBand: null,
    unionMember: null,
    gigWorker: null,
    tippedWorker: null,
    primaryTransitMode: null,
    vehicleTypes: [],
    commuteBand: null,
    specialLicenses: [],
    transitPassHolder: null,
    bikeShareMember: null,
    studentLevel: null,
    parentOfStudent: [],
    educator: null,
    interestTags: [],
    politicalSelfId: null,
    trustedOrganizations: [],
    unionAffiliation: null,
    faithCommunity: null,
    weeklyAttentionMinutes: null,
    preferredDepth: null,
    accessibilityNeeds: [],
    readingLevel: null,
    agingParentsState: null,
    ...initial.signal,
  };
  let sensitive: Record<string, unknown> = {
    __typename: "SensitiveProfile",
    noFieldsMode: false,
    incomeBand: null,
    publicBenefits: null,
    insuranceType: null,
    chronicConditionCategories: null,
    caregiverFor: null,
    reproductiveHealthRelevance: null,
    citizenshipStatus: null,
    veteranStatus: null,
    justiceInvolvement: null,
    raceEthnicity: null,
    primaryLanguages: null,
    religiousCommunity: null,
    lgbtqIdentity: null,
    immigrationGeneration: null,
    tribalAffiliation: null,
    ...initial.sensitive,
  };

  await page.route("**/api", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
      return;
    }
    const body = req.postDataJSON();
    // Match on operationName — `includes(...)` on the raw query
    // string would let "MySignalProfile" capture every operation that
    // contains those characters, including "UpdateMySignalProfile".
    const op = body?.operationName ?? "";
    if (op === "MySignalProfile") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { mySignalProfile: signal } }),
      });
      return;
    }
    if (op === "MySensitiveProfile") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { mySensitiveProfile: sensitive } }),
      });
      return;
    }
    if (op === "UpdateMySignalProfile") {
      const input = body?.variables?.input ?? {};
      log.updateSignalCalls.push(input);
      signal = { ...signal, ...input };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { updateMySignalProfile: signal } }),
      });
      return;
    }
    if (op === "UpdateMySensitiveProfile") {
      const input = body?.variables?.input ?? {};
      log.updateSensitiveCalls.push(input);
      sensitive = { ...sensitive, ...input };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { updateMySensitiveProfile: sensitive } }),
      });
      return;
    }
    if (op === "SetMyNoFieldsMode") {
      const on = Boolean(body?.variables?.on);
      log.noFieldsCalls.push(on);
      if (on) {
        sensitive = {
          ...sensitive,
          noFieldsMode: true,
          incomeBand: null,
          insuranceType: null,
          chronicConditionCategories: null,
          caregiverFor: null,
          reproductiveHealthRelevance: null,
          citizenshipStatus: null,
          veteranStatus: null,
          justiceInvolvement: null,
          raceEthnicity: null,
          primaryLanguages: null,
          religiousCommunity: null,
          lgbtqIdentity: null,
          immigrationGeneration: null,
          tribalAffiliation: null,
        };
      } else {
        sensitive = {
          ...sensitive,
          noFieldsMode: false,
          // restore the pre-toggle veteran value our seed provided
          veteranStatus: initial.sensitive?.veteranStatus ?? null,
        };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { setMyNoFieldsMode: sensitive } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: {} }),
    });
  });

  return log;
}

test.describe("Model-of-me page", () => {
  test("authenticated user lands on the page", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/profile");

    await expect(
      page.getByRole("heading", { level: 1, name: /your model/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/everything we know — or have inferred/i),
    ).toBeVisible();
  });

  test("renders all 13 category sections + 3 placeholders", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/profile");

    // Each category header is a level-3 heading.
    const categoryHeadings = page.getByRole("heading", { level: 3 });
    await expect(categoryHeadings).toHaveCount(13);

    // Placeholders are level-2 ("Behavioral signals" / "Relevance weights" / "Event log") + the no-fields panel.
    await expect(page.getByText(/behavioral signals/i)).toBeVisible();
    await expect(page.getByText(/relevance weights/i)).toBeVisible();
    await expect(page.getByText(/event log/i)).toBeVisible();
  });

  test("no-fields-mode panel toggle is interactive", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/profile");

    const toggle = page.getByRole("checkbox", {
      name: /never store sensitive fields/i,
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });

  test("settings nav exposes a link to /me/profile", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/settings");

    await expect(page.getByRole("link", { name: /your model/i })).toBeVisible();
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/me/profile");
    await expect(page).toHaveURL(/\/login/);
  });

  test("displays correctly on mobile", async ({ page }) => {
    await setupAuthed(page);
    await page.setViewportSize(viewports.mobile);
    await page.goto("/me/profile");

    await expect(
      page.getByRole("heading", { level: 1, name: /your model/i }),
    ).toBeVisible();
  });

  test("category sections collapse and expand via keyboard", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/profile");

    // First T1 category (values / "What you care about") is expanded
    // by default — verify aria-expanded reflects that, then toggle.
    const valuesHeader = page
      .getByRole("button", { name: /expand category|collapse category/i })
      .first();
    await expect(valuesHeader).toHaveAttribute("aria-expanded", "true");
    await valuesHeader.click();
    await expect(valuesHeader).toHaveAttribute("aria-expanded", "false");
  });
});

// The settings-shell sidebar is desktop-first (#766) — at the
// 375px mobile viewport the modal dialog overlay + the no-fields
// toggle target end up overlapped by the layout's outer scroll
// region and Playwright's click can't reach them. The behaviors
// themselves are identical on desktop + tablet, so we skip these
// interaction-heavy tests on both mobile projects until #766
// lands. Render-only mobile assertions in the Responsive Design
// section above stay enabled.
const MOBILE_PROJECTS = ["mobile-chrome", "mobile-safari"];
const skipOnMobile = (testInfo: { project: { name: string } }) =>
  test.skip(
    MOBILE_PROJECTS.includes(testInfo.project.name),
    "#766 — settings shell sidebar overlaps interactive surfaces at mobile widths",
  );

test.describe("Model-of-me — AC happy paths", () => {
  test("edit a field → save → see new value persisted (round trip)", async ({
    page,
  }, testInfo) => {
    skipOnMobile(testInfo);
    await setupAuthed(page);
    const log = await seedProfile(page, {
      signal: { housingTenure: "renter" },
    });
    await page.goto("/me/profile");

    // Wait for skeleton to dismiss + initial read value to render.
    await expect(
      page.getByRole("heading", { level: 1, name: /your model/i }),
    ).toBeVisible();
    await expect(page.getByText("I rent").first()).toBeVisible();

    // `data-field` on the EditableField wrapper gives us a stable
    // selector that survives Tailwind class churn.
    const housingRow = page.locator('[data-field="housingTenure"]');

    await housingRow.getByRole("button", { name: /^edit$/i }).click();
    await housingRow.getByRole("combobox").selectOption("owner");
    await housingRow.getByRole("button", { name: /^save$/i }).click();

    // Mode flips back to read; combobox unmounts.
    await expect(housingRow.getByRole("combobox")).toHaveCount(0);

    // The read-mode `<p>` reflects the new value.
    await expect(housingRow.getByText("I own my home")).toBeVisible();

    expect(log.updateSignalCalls).toHaveLength(1);
    expect(log.updateSignalCalls[0]).toMatchObject({ housingTenure: "owner" });
  });

  test("clear a field → confirm → see Not set persisted (round trip)", async ({
    page,
  }, testInfo) => {
    skipOnMobile(testInfo);
    await setupAuthed(page);
    const log = await seedProfile(page, {
      signal: { housingTenure: "renter" },
    });
    await page.goto("/me/profile");

    const housingRow = page.locator('[data-field="housingTenure"]');
    await expect(housingRow.getByText("I rent")).toBeVisible();

    // Open the clear-confirm dialog from the Clear-value button.
    await housingRow.getByRole("button", { name: /clear value/i }).click();
    await expect(
      page.getByRole("dialog", { name: /clear this value/i }),
    ).toBeVisible();

    // Confirm.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^clear$/i })
      .click();

    // Field shows "Not set" + Clear button disappears (nothing to clear).
    await expect(housingRow.getByText(/not set/i)).toBeVisible();
    await expect(
      housingRow.getByRole("button", { name: /clear value/i }),
    ).toHaveCount(0);

    // Mutation called with explicit null (the cleared sentinel for
    // scalar fields — arrays send [] instead, covered separately).
    expect(log.updateSignalCalls).toHaveLength(1);
    expect(log.updateSignalCalls[0]).toMatchObject({ housingTenure: null });
  });

  test("edit a multi-select-chips field → save → see persisted chips (round trip)", async ({
    page,
  }, testInfo) => {
    skipOnMobile(testInfo);
    await setupAuthed(page);
    const log = await seedProfile(page, {
      signal: { interestTags: ["housing"] },
    });
    await page.goto("/me/profile");

    const interestsRow = page.locator('[data-field="interestTags"]');
    await expect(interestsRow.getByText(/housing & rent$/i)).toBeVisible();

    await interestsRow.getByRole("button", { name: /^edit$/i }).click();

    // Add Healthcare; "Housing & rent" stays selected.
    await interestsRow
      .getByRole("checkbox", { name: /healthcare/i })
      .check({ force: true });

    await interestsRow.getByRole("button", { name: /^save$/i }).click();

    // Read mode shows both chips comma-joined.
    await expect(
      interestsRow.getByText(/housing & rent, healthcare/i),
    ).toBeVisible();

    expect(log.updateSignalCalls).toHaveLength(1);
    expect(log.updateSignalCalls[0]).toMatchObject({
      interestTags: ["housing", "healthcare"],
    });
  });

  test("toggle no-fields-mode on → T3 field locks → toggle off → editable again", async ({
    page,
  }, testInfo) => {
    skipOnMobile(testInfo);
    await setupAuthed(page);
    const log = await seedProfile(page, {
      sensitive: { veteranStatus: "veteran" },
    });
    await page.goto("/me/profile");

    // T3 categories start collapsed — expand civic-status first.
    const civicToggleBtn = page
      .locator("h3 > button")
      .filter({ hasText: /civic status/i });
    await civicToggleBtn.click();

    // `data-field` on the EditableField wrapper is the stable selector.
    const veteranRow = page.locator('[data-field="veteranStatus"]');

    // Pre-toggle: Edit available.
    await expect(
      veteranRow.getByRole("button", { name: /^edit$/i }),
    ).toBeVisible();

    // Toggle on. Use click + outcome-based assert rather than
    // `.check()` — the latter polls the input's `checked` attribute,
    // which races on smaller viewports where React's controlled
    // checkbox state reconciles slightly later than the click event.
    const noFieldsToggle = page.getByRole("checkbox", {
      name: /never store sensitive fields/i,
    });
    await noFieldsToggle.click();

    // Locked: paused note shown, Edit gone.
    await expect(
      veteranRow.getByText(/paused while sensitive fields are off/i),
    ).toBeVisible();
    await expect(
      veteranRow.getByRole("button", { name: /^edit$/i }),
    ).toHaveCount(0);

    // Toggle off — Edit affordance restored.
    await noFieldsToggle.click();
    await expect(
      veteranRow.getByRole("button", { name: /^edit$/i }),
    ).toBeVisible();

    expect(log.noFieldsCalls).toEqual([true, false]);
  });
});

test.describe("Model-of-me — Accessibility (WCAG 2.2 AA)", () => {
  test("default state has no violations", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/profile");
    await expect(
      page.getByRole("heading", { level: 1, name: /your model/i }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });

  test("no-fields-mode panel area has no violations", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/profile");
    await expect(page.getByText(/never store sensitive fields/i)).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });
});
