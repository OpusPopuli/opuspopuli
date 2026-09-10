/**
 * Prefetch policy on dynamic-route links (#1174).
 *
 * Next.js prefetches every <Link> entering the viewport, so N links to a
 * per-item route cost N RSC requests to the Cloudflare Worker. Enough of
 * those at once pushes it past its resource ceiling (Error 1102), which
 * surfaced as "cannot log in" when the login page was one of the renders
 * that failed.
 *
 * This is a SOURCE-LEVEL guard rather than a render test, deliberately:
 * there are ~18 such call sites across 15 files and the failure mode is
 * adding a 19th. A per-component render test would have to be remembered
 * each time; this fails on its own.
 *
 * `prefetch={false}` and not `"auto"`: with no loading.tsx in the app,
 * "auto" still issues one request per link, and request COUNT is what
 * exhausted the Worker.
 *
 * The guard covers two shapes: a templated href (`/region/bills/${id}`),
 * and an href passed in as a prop or variable. The second is opaque at
 * source level, so it demands an explicit decision rather than being
 * assumed safe — that gap is how ActivityRow shipped an unguarded link
 * inside a list.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOTS = ["app", "components"];

/**
 * A singular link may legitimately keep prefetch — the cost is one
 * request and the win is real. Mark those in the source with a
 * `prefetch-ok:` comment stating why, rather than listing paths here:
 * the marker travels with the code and survives line moves.
 */
const OK_MARKER = "prefetch-ok:";

/** Minimum guarded sites; a drop means a regression or a broken regex. */
const EXPECTED_MIN_GUARDED = 15;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) => walk(root));
}

/** Opening `<Link ...>` tags, with their 1-based line number. */
function linkTags(source: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  const re = /<Link\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ tag: m[0], line: source.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** A reasoned exception, inside the tag or on the lines just above it. */
function hasOkMarker(tag: string, source: string, line: number): boolean {
  if (tag.includes(OK_MARKER)) return true;
  // Both placements occur: a JSX comment cannot sit inside a `&&` or
  // ternary branch, so those cases put the marker inside the tag.
  const preceding = source
    .split("\n")
    .slice(Math.max(0, line - 4), line)
    .join("\n");
  return preceding.includes(OK_MARKER);
}

/** True when this link is allowed to prefetch. */
function isExempt(tag: string, source: string, line: number): boolean {
  // A templated href is a per-item route. Same-page fragments (`#term-x`)
  // never trigger a route prefetch.
  const templated = /href=\{`/.test(tag) && !/href=\{`#/.test(tag);

  // An href arriving as a prop or variable is OPAQUE to a source-level
  // guard: `<Link href={href}>` inside a row component may well point at a
  // per-item route, and several do. This was a real blind spot — the
  // region layer pages feed `/region/bills/${id}` into ActivityRow, which
  // rendered an unguarded Link, so a list of five bills issued five
  // prefetches while this test stayed green. Opaque means "state your
  // intent", not "assume it is fine": either prefetch={false}, or a
  // prefetch-ok: marker saying why one request is acceptable here.
  const indirect = /href=\{(?!`)/.test(tag) && !/href=\{\s*["'`]#/.test(tag);

  if (!templated && !indirect) return true;
  if (tag.includes("prefetch={false}")) return true;
  return hasOkMarker(tag, source, line);
}

function findOffenders(): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const { tag, line } of linkTags(source)) {
      if (!isExempt(tag, source, line)) offenders.push(`${file}:${line}`);
    }
  }
  return offenders;
}

function countGuarded(): number {
  return sourceFiles().reduce((n, file) => {
    const tags = linkTags(readFileSync(file, "utf8"));
    return n + tags.filter((t) => t.tag.includes("prefetch={false}")).length;
  }, 0);
}

describe("dynamic-route links do not prefetch (#1174)", () => {
  it("every <Link> to a dynamic route disables prefetch or is a documented exception", () => {
    expect(findOffenders()).toEqual([]);
  });

  it("treats an href arriving as a prop as needing an explicit decision", () => {
    // The rule this file exists to enforce is easy to widen and easy to
    // narrow back by accident. These assertions pin the two shapes it must
    // catch and the three it must not, so a regex edit that quietly stops
    // matching fails here rather than going green with real offenders in
    // the tree — which is exactly how ActivityRow slipped through.
    expect(isExempt("<Link href={href}>", "", 1)).toBe(false);
    expect(isExempt("<Link href={`/region/bills/${id}`}>", "", 1)).toBe(false);

    expect(isExempt('<Link href="/region">', "", 1)).toBe(true);
    expect(isExempt("<Link href={`#term-x`}>", "", 1)).toBe(true);
    expect(isExempt("<Link href={href} prefetch={false}>", "", 1)).toBe(true);
    expect(
      isExempt("<Link\n  // prefetch-ok: reason\n  href={href}>", "", 1),
    ).toBe(true);
  });

  it("guards a meaningful number of call sites", () => {
    // If this drops, either the fix regressed or the tag regex stopped
    // matching and the assertion above went quietly green.
    expect(countGuarded()).toBeGreaterThanOrEqual(EXPECTED_MIN_GUARDED);
  });
});
