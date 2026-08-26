/**
 * Design-token contrast invariants (WCAG 2.2 AA)
 *
 * The page-level a11y specs only catch a bad token pair if some page happens to
 * render that pair today. This spec checks the token system directly, so a
 * regression is caught even when no page currently uses the combination.
 *
 * It exists because of a real escape: `.on-fixed-dark` re-pointed the status
 * TEXT tokens to their dark values but left the matching `-surface` tints at
 * their light values, so `bg-positive-surface text-positive` rendered at 1.78:1
 * inside the petition results page. Every scope must flip a COMPLETE tuple.
 *
 * Run with: pnpm e2e e2e/design-tokens.spec.ts
 */

import { test, expect } from "@playwright/test";

/** Status + categorical ramps. Each has a `-surface` tint partner. */
const TOKENS = [
  "danger",
  "warning",
  "positive",
  "info",
  "cat-blue",
  "cat-red",
  "cat-purple",
  "cat-green",
  "cat-amber",
  "cat-teal",
] as const;

/** Every context in which the semantic tokens resolve to a different set. */
const SCOPES = [
  { name: "light root", dark: false, className: "" },
  { name: "light > on-ink", dark: false, className: "on-ink" },
  { name: "light > on-fixed-dark", dark: false, className: "on-fixed-dark" },
  { name: "dark root", dark: true, className: "" },
  { name: "dark > on-ink", dark: true, className: "on-ink" },
  { name: "dark > on-fixed-dark", dark: true, className: "on-fixed-dark" },
] as const;

const AA_NORMAL_TEXT = 4.5;

function relativeLuminance(hex: string): number {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

test.describe("Design tokens — contrast invariants", () => {
  for (const scope of SCOPES) {
    test(`${scope.name}: every status/categorical tuple meets AA`, async ({
      page,
    }) => {
      await page.goto("/login");

      const resolved = await page.evaluate(
        ({ dark, className, tokens }) => {
          const root = document.documentElement;
          const hadDark = root.classList.contains("dark");
          root.classList.toggle("dark", dark);

          const el = document.createElement("div");
          if (className) el.className = className;
          document.body.appendChild(el);

          const cs = getComputedStyle(el);
          const read = (name: string) => cs.getPropertyValue(name).trim();

          const out: Record<string, { fg: string; tint: string }> = {};
          for (const t of tokens) {
            out[t] = {
              fg: read(`--color-${t}`),
              tint: read(`--color-${t}-surface`),
            };
          }
          const pageSurface = read("--color-surface");

          el.remove();
          root.classList.toggle("dark", hadDark);
          return { out, pageSurface };
        },
        { dark: scope.dark, className: scope.className, tokens: [...TOKENS] },
      );

      const failures: string[] = [];
      for (const token of TOKENS) {
        const { fg, tint } = resolved.out[token];

        // A token that fails to resolve would silently render as no colour.
        expect(fg, `--color-${token} unset in ${scope.name}`).not.toBe("");
        expect(
          tint,
          `--color-${token}-surface unset in ${scope.name}`,
        ).not.toBe("");

        const onTint = contrastRatio(fg, tint);
        const onPage = contrastRatio(fg, resolved.pageSurface);

        // On its own tint: the badge/banner case.
        if (onTint < AA_NORMAL_TEXT) {
          failures.push(
            `${token}: ${fg} on its tint ${tint} = ${onTint.toFixed(2)}:1`,
          );
        }
        // On the page surface: the bare "text-danger" case.
        if (onPage < AA_NORMAL_TEXT) {
          failures.push(
            `${token}: ${fg} on page ${resolved.pageSurface} = ${onPage.toFixed(2)}:1`,
          );
        }
      }

      expect(
        failures,
        `Contrast below ${AA_NORMAL_TEXT}:1 in "${scope.name}".\n` +
          `A token and its -surface partner must always come from the same ` +
          `ramp — see the --ramp-* block in app/globals.css.\n  ` +
          failures.join("\n  "),
      ).toEqual([]);
    });
  }

  /**
   * Second escape class, found in #1069.
   *
   * `--color-paper` / `--color-ink` are FIXED brand constants: they never flip.
   * `--color-inverse-surface` is theme-relative and, under `.on-fixed-dark`, is
   * re-pointed to paper. So `text-paper` on `bg-inverse-surface` — which reads
   * as an obviously safe "light text on a dark panel" pair — rendered paper on
   * paper at 1:1 on the scan surface, making the report-issue panel's heading
   * invisible.
   *
   * The tuple check above cannot catch this: neither token is a status ramp.
   * What this pins is the invariant the correct code relies on — a panel
   * token contrasts with its OWN partner (`--color-on-inverse`) in every
   * scope, which is what makes `.on-ink` a safe fix.
   *
   * Note the limit: reaching for a fixed constant instead is a USAGE bug, and
   * no token-level assertion can see it. That half is pinned where it happens,
   * in the ReportIssueButton spec.
   */
  for (const scope of SCOPES) {
    test(`${scope.name}: inverse-surface pairs with on-inverse, not the fixed ramp`, async ({
      page,
    }) => {
      await page.goto("/login");

      const resolved = await page.evaluate(
        ({ dark, className }) => {
          const root = document.documentElement;
          const hadDark = root.classList.contains("dark");
          root.classList.toggle("dark", dark);

          const el = document.createElement("div");
          if (className) el.className = className;
          document.body.appendChild(el);

          const cs = getComputedStyle(el);
          const read = (name: string) => cs.getPropertyValue(name).trim();

          const out = {
            inverseSurface: read("--color-inverse-surface"),
            onInverse: read("--color-on-inverse"),
          };

          el.remove();
          root.classList.toggle("dark", hadDark);
          return out;
        },
        { dark: scope.dark, className: scope.className },
      );

      for (const [name, value] of Object.entries(resolved)) {
        expect(value, `--color-${name} unset in ${scope.name}`).not.toBe("");
      }

      // The sanctioned pair must always be legible.
      expect(
        contrastRatio(resolved.onInverse, resolved.inverseSurface),
        `on-inverse ${resolved.onInverse} on inverse-surface ` +
          `${resolved.inverseSurface} in "${scope.name}"`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }
});
