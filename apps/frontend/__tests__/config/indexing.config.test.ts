/**
 * What search engines may index (#1456).
 */
import {
  NOINDEX_HEADER,
  PRIVATE_PAGES,
  PRIVATE_SECTIONS,
  getNoIndexHeaderRules,
  getRobotsDisallow,
} from "@/config/indexing.config.mjs";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { CIVIC_SITEMAP_IDS } from "@/lib/server/civic-sitemap";

/** Whether a robots.txt disallow entry blocks a path, Google-style. */
function blocks(rule: string, path: string): boolean {
  return rule.endsWith("$")
    ? path === rule.slice(0, -1)
    : path.startsWith(rule);
}

const blocked = (path: string) =>
  getRobotsDisallow().some((rule) => blocks(rule, path));

describe("indexing (#1456)", () => {
  it("lets crawlers into the civic record", () => {
    for (const path of [
      "/region",
      "/region/propositions/abc",
      "/region/bills/abc",
      "/region/sitemap/bills-0.xml",
    ]) {
      expect(blocked(path)).toBe(false);
    }
  });

  it("keeps crawlers out of a reader's own areas", () => {
    for (const path of [
      "/me",
      "/me/briefing",
      "/settings",
      "/settings/addresses",
      "/petition",
      "/petition/map",
      "/onboarding",
      "/auth/callback",
      "/api/",
    ]) {
      expect(blocked(path)).toBe(true);
    }
  });

  it("anchors a section, so a future /media isn't caught by /me", () => {
    expect(blocked("/media")).toBe(false);
    expect(blocked("/meetings")).toBe(false);
  });

  it("marks every private path noindex, and nothing in the civic record", () => {
    const sources = getNoIndexHeaderRules().map((rule) => rule.source);
    for (const section of PRIVATE_SECTIONS) {
      expect(sources).toEqual(
        expect.arrayContaining([section, `${section}/:path*`]),
      );
    }
    expect(sources).toEqual(expect.arrayContaining(PRIVATE_PAGES));
    expect(sources.some((s) => s.startsWith("/region"))).toBe(false);
    for (const rule of getNoIndexHeaderRules()) {
      expect(rule.headers).toEqual([NOINDEX_HEADER]);
    }
  });

  it("leaves the auth pages crawlable, so their noindex can be seen", () => {
    for (const page of PRIVATE_PAGES) expect(blocked(page)).toBe(false);
  });

  it("lists every civic sitemap in robots.txt", () => {
    const listed = robots().sitemap as string[];
    for (const id of CIVIC_SITEMAP_IDS) {
      expect(
        listed.some((url) => url.endsWith(`/region/sitemap/${id}.xml`)),
      ).toBe(true);
    }
  });

  it("keeps sign-in and sign-up out of the site sitemap", () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).not.toContain("/login");
    expect(urls).not.toContain("/register");
  });
});
