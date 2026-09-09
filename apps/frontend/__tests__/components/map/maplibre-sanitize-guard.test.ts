import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Enforces the assumptions that make GHSA-jrc7-96c5-q579 unreachable.
 *
 * That advisory (CVSS 10) is an XSS sanitizer bypass in maplibre's
 * `DOM.sanitize()`. Its vulnerable range covers ALL of maplibre 5.x, and we
 * cannot move to the patched 6.4.1+ because no deck.gl release supports
 * maplibre 6 — the map renders blank (#1187). So it is suppressed in
 * `pnpm.auditConfig.ignoreGhsas` to keep the push gate meaningful for
 * everything else.
 *
 * A suppression is permanent and global; the analysis that justified it is
 * not. This file is what stops the two outliving each other.
 *
 * ── Why it is currently unreachable ──────────────────────────────────────
 *
 * In the installed bundle, `sanitize()` has exactly ONE call site:
 *
 *     this._innerContainer.innerHTML = h.sanitize(...)   // _updateAttributions()
 *
 * — the attribution control. We disable it on every map, and the style
 * carries no sources, so there is no attribution HTML to render in the first
 * place.
 *
 * ── The trap this guards ─────────────────────────────────────────────────
 *
 * `Popup.setHTML` does NOT sanitize at all — it assigns `innerHTML`
 * directly. So a popup rendering scraped text is an XSS exposure whether or
 * not this advisory is suppressed, and fixing the advisory would not protect
 * it. Popup content is trusted-input-only, which is easy not to know.
 *
 * If one of these assertions fails, do not simply relax it. Either keep the
 * property, or re-open the exposure analysis in #1188 before changing the
 * suppression.
 */

const MAP_DIR = new URL("../../../components/map/", import.meta.url).pathname;

function sourceFiles(): { name: string; code: string }[] {
  return readdirSync(MAP_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((name) => {
      const raw = readFileSync(join(MAP_DIR, name), "utf8");
      // Strip comments so this prose does not match its own assertions.
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return { name, code };
    });
}

describe("maplibre sanitize-path guard (GHSA-jrc7-96c5-q579, #1187)", () => {
  it("finds the map components", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => f.name)).toContain("CivicMap.tsx");
  });

  // The one sanitize() consumer in the library.
  it("never enables the attribution control", () => {
    for (const { name, code } of sourceFiles()) {
      if (!/attributionControl/.test(code)) continue;
      expect(
        `${name}: ${code.match(/attributionControl[^,\n]*/)?.[0]}`,
      ).toMatch(/attributionControl\s*[:=]\s*(false|\{\s*false\s*\})/);
    }
  });

  it("constructs no maplibre Popup", () => {
    for (const { name, code } of sourceFiles()) {
      expect(`${name} must not construct a Popup`).toBe(
        /new\s+(maplibregl\.)?Popup\b/.test(code)
          ? `${name} constructs a maplibre Popup — see the note above`
          : `${name} must not construct a Popup`,
      );
    }
  });

  it("passes no HTML to maplibre and sets no innerHTML", () => {
    // setHTML/setDOMContent are the popup content APIs; setHTML is unsanitized.
    const banned = /\.setHTML\s*\(|\.setDOMContent\s*\(|\.innerHTML\s*=/;
    for (const { name, code } of sourceFiles()) {
      expect(`${name}: ${banned.test(code) ? "USES HTML API" : "clean"}`).toBe(
        `${name}: clean`,
      );
    }
  });
});
