/**
 * No hardcoded copy in region page headers (#1160).
 *
 * A source-level guard, like `link-prefetch.test.tsx`, because the failure
 * mode is adding an eleventh page rather than breaking an existing one.
 *
 * The reason this needs a guard at all: the "Where you live" rework moved
 * every leaf page's title and subtitle out of the page body and into
 * `RegionPageHeader`'s `title` / `meta` props. That made them look handled
 * — a component contract rather than loose JSX — while they were still
 * English literals. `RegionPageHeader` does not localise what it is given;
 * it renders what the caller passes.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join("app", "region");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith("page.tsx") ? [full] : [];
  });
}

/** The opening `<RegionPageHeader …>` tag, if the file renders one. */
function headerTag(source: string): string | null {
  const match = /<RegionPageHeader\b[\s\S]*?\/>/.exec(source);
  return match ? match[0] : null;
}

describe("region page headers carry no hardcoded copy (#1160)", () => {
  const files = walk(ROOT).filter((f) => headerTag(readFileSync(f, "utf8")));

  it("finds the headers to check", () => {
    // If this drops, either pages were deleted or the tag regex stopped
    // matching and every assertion below went quietly green.
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  it.each(files)("%s passes no string literal as title or meta", (file) => {
    const tag = headerTag(readFileSync(file, "utf8")) as string;
    expect(tag).not.toMatch(/title="[^"]/);
    expect(tag).not.toMatch(/meta="[^"]/);
    expect(tag).not.toMatch(/title=\{"[^"]/);
    expect(tag).not.toMatch(/meta=\{"[^"]/);
  });

  it.each(files)(
    "%s passes no string literal as a breadcrumb label",
    (file) => {
      const tag = headerTag(readFileSync(file, "utf8")) as string;
      // Trail segments are as visible as the title and were hardcoded in the
      // same places, so they are held to the same rule.
      expect(tag).not.toMatch(/label:\s*"[^"]/);
    },
  );
});
