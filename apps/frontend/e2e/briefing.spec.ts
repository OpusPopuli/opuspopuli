/**
 * Civic briefing home page E2E (#744).
 *
 * Covers the AC-required behaviors: page renders for authed users,
 * navigation in + out (Header, "Browse all civic data →", placeholder
 * see-all linkouts), unauthenticated → /login redirect, plus WCAG 2.2
 * AA axe scans. Per-bill content rendering + Why-this expansion are
 * covered by unit tests against the components.
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

// The settings shell's mobile sidebar overlap (#766) doesn't apply to
// the briefing page (it uses the Header/Footer pattern, not the
// settings shell), but we keep the mobile-skip pattern available in
// case other mobile-only chrome issues surface.
const MOBILE_PROJECTS = ["mobile-chrome", "mobile-safari"];

test.describe("Civic briefing page", () => {
  test("authenticated user lands on the page with greeting + four sections", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    // The h1 is the personalized greeting (#849) — replaces the
    // static "Your Civic Briefing" title to declutter the top of
    // the page. Matches any time-of-day variant + named OR
    // neighbor branch.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /good (morning|afternoon|evening)/i,
      }),
    ).toBeVisible();

    // 4 h2 headings — one per section (Bills + Reps + Committees +
    // Propositions). The greeting block is the h1, not an h2.
    const sectionHeadings = page.getByRole("heading", { level: 2 });
    await expect(sectionHeadings).toHaveCount(4);
  });

  test("Browse all civic data → navigates to /region", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    const link = page.getByRole("link", {
      name: /browse all civic data/i,
    });
    await expect(link).toHaveAttribute("href", "/region");
  });

  test("Reps placeholder See all → /region/representatives", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    const repsSection = page.locator('[data-section="reps"]');
    await expect(repsSection).toBeVisible();
    await expect(
      repsSection.getByRole("link", { name: /see all/i }),
    ).toHaveAttribute("href", "/region/representatives");
  });

  test("Committees placeholder See all → /region/legislative-committees", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="committees"]');
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("link", { name: /see all/i }),
    ).toHaveAttribute("href", "/region/legislative-committees");
  });

  test("Propositions section See all → /region/propositions (#771)", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="propositions"]');
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("link", { name: /see all/i }),
    ).toHaveAttribute("href", "/region/propositions");
  });

  test("Bills section See all → /region/bills", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="bills"]');
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("link", { name: /see all/i }),
    ).toHaveAttribute("href", "/region/bills");
  });

  test("Header includes a Briefing nav link back to /me/briefing", async ({
    page,
  }, testInfo) => {
    test.skip(
      MOBILE_PROJECTS.includes(testInfo.project.name),
      "Header desktop nav is hidden < md viewport; mobile menu flow is unit-tested in Header.test.tsx",
    );
    await setupAuthed(page);
    await page.goto("/region");

    // Header should expose the Briefing link for authed users.
    await expect(
      page.getByRole("link", { name: /^briefing$/i }),
    ).toHaveAttribute("href", "/me/briefing");
  });

  test("Logo in the Header points at the briefing when authenticated", async ({
    page,
  }, testInfo) => {
    test.skip(
      MOBILE_PROJECTS.includes(testInfo.project.name),
      "Mobile logo behavior is identical but the desktop nav assertion shape varies — covered by Header unit tests",
    );
    await setupAuthed(page);
    await page.goto("/region");

    const logoLink = page.getByRole("link", { name: /opus populi/i }).first();
    await expect(logoLink).toHaveAttribute("href", "/me/briefing");
  });

  test("Why-this panel surfaces a source link on at least one bill (#750)", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    // Open every visible Why-this toggle — the panels are independent
    // disclosures so we can have multiple expanded at once. After the
    // sweep, assert that at least one source link rendered.
    //
    // CI seeded state may have zero bills in the feed (no completed
    // SignalProfile / no qualifying bills against the seed data), in
    // which case the toggles don't exist. The source-link contract
    // (target=_blank, rel=noopener) is exhaustively covered by the
    // WhyThisPanel unit tests; this e2e is a smoke test against live
    // UAT data, not a contract assertion — skip cleanly when no
    // panels are present so this test passes in data-empty CI states.
    const toggles = page.getByRole("button", {
      name: /why is this on my briefing/i,
    });
    const toggleCount = await toggles.count();
    test.skip(
      toggleCount === 0,
      "No bill cards in the seeded feed; WhyThisPanel.test.tsx covers the source-link contract",
    );
    for (let i = 0; i < toggleCount; i++) {
      const toggle = toggles.nth(i);
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
    }

    const sourceLinks = page.getByRole("link", { name: /read the source/i });
    await expect(sourceLinks.first()).toBeVisible();
    await expect(sourceLinks.first()).toHaveAttribute("target", "_blank");
    await expect(sourceLinks.first()).toHaveAttribute("rel", /noopener/);
  });

  test("greeting block renders above the sections with a summary line (#849)", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    const greeting = page.getByTestId("briefing-greeting");
    await expect(greeting).toBeVisible();

    // Heading is a friendly time-of-day greeting; assert one of the
    // three EN variants (named OR neighbor branch). Avoid asserting on
    // a specific firstName because the seeded user can be either with
    // or without a name across CI states.
    const heading = greeting.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(/good (morning|afternoon|evening),? \S+/i);

    // Summary sentence mentions all four section types so the citizen
    // sees a count anchor before scrolling.
    await expect(greeting).toContainText(/bills/i);
    await expect(greeting).toContainText(/representatives/i);
    await expect(greeting).toContainText(/committees/i);
    await expect(greeting).toContainText(/propositions/i);
  });

  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/me/briefing");
    await expect(page).toHaveURL(/\/login/);
  });

  test("displays correctly on mobile", async ({ page }, testInfo) => {
    test.skip(
      MOBILE_PROJECTS.includes(testInfo.project.name),
      "Header mobile menu interaction covered by Header unit tests; this only asserts render",
    );
    await setupAuthed(page);
    await page.setViewportSize(viewports.mobile);
    await page.goto("/me/briefing");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /good (morning|afternoon|evening)/i,
      }),
    ).toBeVisible();
  });
});

test.describe("Civic briefing — Accessibility (WCAG 2.2 AA)", () => {
  test("default state has no violations", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /good (morning|afternoon|evening)/i,
      }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });
});
