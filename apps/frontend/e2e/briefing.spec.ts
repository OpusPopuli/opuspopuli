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
  test("authenticated user lands on the page with header + four sections", async ({
    page,
  }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");

    await expect(
      page.getByRole("heading", { level: 1, name: /your civic briefing/i }),
    ).toBeVisible();

    // 4 section headings (Bills + Reps + Committees + Propositions)
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

  test("Propositions placeholder See all → /region/propositions", async ({
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
      page.getByRole("heading", { level: 1, name: /your civic briefing/i }),
    ).toBeVisible();
  });
});

test.describe("Civic briefing — Accessibility (WCAG 2.2 AA)", () => {
  test("default state has no violations", async ({ page }) => {
    await setupAuthed(page);
    await page.goto("/me/briefing");
    await expect(
      page.getByRole("heading", { level: 1, name: /your civic briefing/i }),
    ).toBeVisible();
    expect(await checkAccessibility(page)).toEqual([]);
  });
});
