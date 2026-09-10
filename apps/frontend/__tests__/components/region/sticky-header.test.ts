/**
 * The region header's sticky offset resolves to a real value.
 *
 * `RegionPageHeader` pins the breadcrumb with `top-[var(--op-header-h)]`.
 * The variable was originally declared inside `@theme`, and Tailwind v4
 * only emits @theme entries in a recognised namespace (--color-*, --font-*,
 * --spacing-*, …) — so it was pruned from the stylesheet, `top` resolved to
 * nothing and fell back to `auto`, and a sticky element with `top: auto`
 * never sticks.
 *
 * Nothing else in the suite could catch that: the class was applied, the
 * element rendered, the accessibility tree was correct. The bar looked
 * right and simply scrolled away. So this asserts the one thing that was
 * actually missing — that the variable is declared somewhere the compiler
 * will emit.
 */

import { readFileSync } from "fs";
import { join } from "path";

const CSS = readFileSync(join("app", "globals.css"), "utf8");
const HEADER = readFileSync(
  join("components", "region", "RegionPageHeader.tsx"),
  "utf8",
);

/**
 * The body of the `@theme { … }` at-rule.
 *
 * Anchored to the start of a line: the file's header comment mentions
 * "@theme" in prose, and matching that instead sliced from the comment and
 * swept up the very declaration this guard exists to check.
 */
function themeBlock(css: string): string {
  const start = /^@theme\s*\{/m.exec(css)?.index ?? -1;
  if (start === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return css.slice(start);
}

describe("region header sticky offset", () => {
  it("declares --op-header-h outside @theme so it survives the build", () => {
    expect(CSS).toMatch(/--op-header-h:\s*\d+px/);
    expect(themeBlock(CSS)).not.toContain("--op-header-h");
  });

  it("is the offset the pinned header actually uses", () => {
    // If the header stops referencing it, this guard is protecting nothing
    // and should be deleted rather than left to pass vacuously.
    expect(HEADER).toContain("top-[var(--op-header-h)]");
    expect(HEADER).toContain("sticky");
  });
});
