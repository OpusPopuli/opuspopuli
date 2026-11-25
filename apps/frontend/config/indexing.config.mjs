/**
 * What search engines may index (#1456).
 *
 * The civic record (`/region`) is public and indexed. A reader's own areas
 * are not: their briefing, settings, scans, onboarding and the auth flow.
 * One list feeds both `robots.txt` (app/robots.ts) and the `X-Robots-Tag`
 * header (next.config.mjs), so the two can't drift apart.
 *
 * The header, not page metadata, because most of these segments render
 * through client-component layouts, which can't export metadata.
 */

/** Sections whose every page is the reader's own, or account plumbing. */
export const PRIVATE_SECTIONS = [
  "/me",
  "/settings",
  "/petition",
  "/onboarding",
  "/auth",
];

/** Single pages crawlers may fetch, but must not list. */
export const PRIVATE_PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

export const NOINDEX_HEADER = {
  key: "X-Robots-Tag",
  value: "noindex, nofollow",
};

/** next.config `headers()` rules marking every private path noindex. */
export function getNoIndexHeaderRules() {
  const sources = [
    ...PRIVATE_SECTIONS.flatMap((section) => [section, `${section}/:path*`]),
    ...PRIVATE_PAGES,
  ];
  return sources.map((source) => ({ source, headers: [NOINDEX_HEADER] }));
}

/**
 * `robots.txt` disallow entries. Sections are disallowed outright. The
 * single auth pages are left crawlable on purpose: a crawler that may not
 * fetch a page never sees its noindex, and can still list a bare URL it
 * found linked elsewhere.
 *
 * Each section twice: `/me$` for the page itself (`$` anchors the end, so
 * a future `/media` isn't caught by a bare `/me` prefix) and `/me/` for
 * everything under it.
 */
export function getRobotsDisallow() {
  return [
    "/api/",
    ...PRIVATE_SECTIONS.flatMap((section) => [`${section}$`, `${section}/`]),
  ];
}
