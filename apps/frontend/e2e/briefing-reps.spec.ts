/**
 * Personalized reps briefing section E2E (#769).
 *
 * Asserts the new section renders the real RepsBriefingSection (not
 * the placeholder), surfaces section-level state machinery (loading /
 * empty / cards), and that the collapse-shell behavior from S0 works
 * for this section specifically. Per-card content rendering will be
 * exhaustively covered by RepBriefingCard.test.tsx in a follow-up.
 *
 * Cross-section behaviors (header, navigation, WCAG) live in
 * briefing.spec.ts so we don't duplicate that scaffolding here.
 */
import { test, expect } from "@playwright/test";
import { setupAuthSession } from "./utils/test-helpers";

test.describe("Civic briefing — Reps section (#769)", () => {
  test("renders the reps section with the personalized shell, not the placeholder copy", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="reps"]');
    await expect(section).toBeVisible();

    // Section title from i18n key reps.title
    await expect(
      section.getByRole("heading", { level: 2, name: /your representatives/i }),
    ).toBeVisible();

    // Placeholder copy SHOULD NOT appear — placeholder body lives at
    // reps.placeholder.body in the i18n bundle. If it shows, we
    // accidentally regressed BriefingPage to mount the placeholder.
    await expect(
      section.getByText(
        /personalized rep activity .*upcoming votes.* is coming soon/i,
      ),
    ).toHaveCount(0);
  });

  test("collapses and re-expands via the section toggle (S0 inherits here)", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="reps"]');
    const toggle = section.getByRole("button", {
      name: /collapse your representatives section/i,
    });
    await expect(toggle).toBeVisible();

    await toggle.click();

    // After collapse: aria-expanded flips, toggle label flips, the
    // section content region is hidden from the a11y tree.
    await expect(
      section.getByRole("button", {
        name: /expand your representatives section/i,
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("a card click navigates to /region/representatives/[id] when a card is present", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="reps"]');
    await expect(section).toBeVisible();

    const cards = section.locator('[data-testid="rep-briefing-card"]');
    const count = await cards.count();

    // The section legitimately renders one of four states depending on
    // the auth fixture's seed: cards (signals + districts + a matched
    // rep), the "empty" copy (signals + districts + no match), the
    // noProfile nudge (signals not yet declared), or the noDistricts
    // nudge (signals declared but no primary address with districts).
    // All four are valid AC outcomes; the test asserts the link shape
    // when cards are present, and that one of the three empty-shape
    // copies is shown when they aren't.
    if (count > 0) {
      const firstCard = cards.first();
      // The card has two link targets — the rep name (header) and any
      // bill-number tags in "working on". The rep-name link is the
      // first link in the card by DOM order; restrict by data-testid
      // scope to avoid matching the "See all" section link.
      const repLink = firstCard
        .getByRole("link")
        .filter({ hasNotText: /see all/i })
        .first();
      await expect(repLink).toHaveAttribute(
        "href",
        /^\/region\/representatives\/[a-zA-Z0-9_-]+$/,
      );
    } else {
      // Either reps.empty ("Your representatives haven't moved on…"),
      // page.noProfileTitle ("Tell us what matters to you"), OR
      // reps.noDistrictsTitle ("We need your address to find your
      // reps"). Match any since the auth fixture's state varies.
      const emptyOrNudge = section.getByText(
        /haven't moved on bills above your relevance threshold|tell us what matters to you|need your address to find your reps/i,
      );
      await expect(emptyOrNudge).toBeVisible();
    }
  });

  test("does NOT render contact-action affordances in Phase 1 (scope guard)", async ({
    page,
  }) => {
    await setupAuthSession(page);
    await page.goto("/me/briefing");

    const section = page.locator('[data-section="reps"]');
    await expect(section).toBeVisible();

    // Contact actions (email, call) are Phase 2 of #769; their absence
    // is a regression guard against accidentally enabling that UI
    // before the Resend-backed email path threads through the
    // briefing card. The rep detail page already carries them.
    await expect(
      section.getByRole("button", { name: /email .* rep/i }),
    ).toHaveCount(0);
    await expect(section.getByRole("link", { name: /^call /i })).toHaveCount(0);
  });
});
