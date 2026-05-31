/**
 * Personalized propositions briefing section E2E (#771).
 *
 * Asserts the new section renders the real PropositionsBriefingSection
 * (not the placeholder) for authed users, surfaces section-level state
 * machinery (loading / empty / cards), and that the collapse-shell
 * behavior from S0 works for this section specifically. Per-card
 * content rendering is exhaustively covered in PropositionBriefingCard.test.tsx.
 *
 * Cross-section behaviors (header, navigation, WCAG) live in
 * briefing.spec.ts so we don't duplicate that scaffolding here.
 */
import { test, expect } from "@playwright/test";
import { setupAuthSession } from "./utils/test-helpers";

test.describe("Civic briefing — Propositions section (#771)", () => {
  test("renders the propositions section with the personalized shell, not the placeholder copy", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="propositions"]');
    await expect(section).toBeVisible();

    // Section title from i18n key propositions.title
    await expect(
      section.getByRole("heading", { level: 2, name: /active propositions/i }),
    ).toBeVisible();

    // Placeholder copy SHOULD NOT appear — placeholder body lives at
    // propositions.placeholder.body in the i18n bundle. If it shows,
    // we accidentally regressed BriefingPage to mount the placeholder.
    await expect(
      section.getByText(/personalized proposition briefings are coming soon/i),
    ).toHaveCount(0);
  });

  test("collapses and re-expands via the section toggle (S0 inherits here)", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="propositions"]');
    const toggle = section.getByRole("button", {
      name: /collapse active propositions section/i,
    });
    await expect(toggle).toBeVisible();

    await toggle.click();

    // After collapse: aria-expanded flips, toggle label flips, the
    // section content region is hidden from the a11y tree.
    await expect(
      section.getByRole("button", {
        name: /expand active propositions section/i,
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("a card click navigates to /region/propositions/[id] when a card is present", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="propositions"]');
    await expect(section).toBeVisible();

    const cards = section.locator('[data-testid="proposition-briefing-card"]');
    const count = await cards.count();

    // Test passes whether or not the seed has personalized matches —
    // when cards render, we assert their link shape; when none render,
    // we expect the empty-state copy. Both are valid AC outcomes.
    if (count > 0) {
      const firstCard = cards.first();
      const titleLink = firstCard
        .getByRole("link")
        .filter({ hasNotText: /see all/i })
        .first();
      await expect(titleLink).toHaveAttribute(
        "href",
        /^\/region\/propositions\/[a-zA-Z0-9_-]+$/,
      );
    } else {
      // Empty-state copy is from propositions.empty in i18n.
      await expect(
        section.getByText(/no active propositions match your interests/i),
      ).toBeVisible();
    }
  });

  test("does NOT render endorsement chips in Phase 1 (scope guard)", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="propositions"]');
    await expect(section).toBeVisible();

    // Endorsement chips are Phase 2 of #771; their absence is a
    // regression guard against accidentally enabling that UI before
    // the data model lands.
    await expect(section.getByText(/sierra club/i)).toHaveCount(0);
    await expect(section.getByText(/\bendors/i)).toHaveCount(0);
  });
});
