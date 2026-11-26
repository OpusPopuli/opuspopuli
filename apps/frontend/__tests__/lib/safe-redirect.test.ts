/**
 * `?redirect=` after sign-in stays on this site (#1456: the account prompts
 * now send many more visitors through /login?redirect=).
 */
import { safeRedirect } from "@/lib/safe-redirect";

const FALLBACK = "/onboarding";

describe("safeRedirect", () => {
  it.each([
    ["/region/bills/abc", "/region/bills/abc"],
    ["/region?x=1#top", "/region?x=1#top"],
    ["/me/briefing", "/me/briefing"],
  ])("keeps a path on this site: %s", (raw, expected) => {
    expect(safeRedirect(raw, FALLBACK)).toBe(expected);
  });

  it.each([
    // A browser treats a backslash as a slash: these resolve to evil.com,
    // and the old shape check (starts with one slash, not two) let them by.
    "/\\evil.com",
    "/\\/evil.com",
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
  ])("refuses anything that leaves this site: %p", (raw) => {
    expect(safeRedirect(raw, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when there's no redirect at all", () => {
    expect(safeRedirect(null, FALLBACK)).toBe(FALLBACK);
  });

  it("normalises an encoded or tabbed path, which stays on this site", () => {
    expect(safeRedirect("/%5Cevil.com", FALLBACK)).toBe("/%5Cevil.com");
    expect(safeRedirect("/\tevil.com", FALLBACK)).toBe("/evil.com");
  });
});
