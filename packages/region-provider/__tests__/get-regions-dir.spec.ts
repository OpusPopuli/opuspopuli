import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getRegionsDir } from "../src/index";

/**
 * These assertions were previously "ends in /regions", "is absolute" and "is
 * stable across calls" — all three of which pass while the function returns a
 * path that does not exist, or one pointing at a DIFFERENT version of
 * @opuspopuli/regions than this package declares. That is exactly the failure
 * that shipped on 2026-09-24 (#1328): the walk served regions 1.0.96 config
 * while the bumped pin said 1.0.97, and nothing anywhere reported it.
 *
 * So they now assert the two things that actually matter: the directory EXISTS
 * with configs in it, and it is the version this package pins.
 */
describe("getRegionsDir", () => {
  it("returns a directory that exists and holds region configs", () => {
    const dir = getRegionsDir();

    expect(existsSync(dir)).toBe(true);
    const entries = readdirSync(dir);
    // federal.json plus at least one region directory.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain("federal.json");
  });

  it("resolves the version THIS package declares, not a consumer's", () => {
    // The pin that decides what the region service loads is this package's,
    // because the walk finds the nearest copy first. Asserting it here is what
    // makes a silent version split fail a test instead of a production sync.
    const declared = (
      JSON.parse(
        readFileSync(join(__dirname, "..", "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> }
    ).dependencies?.["@opuspopuli/regions"];
    expect(declared).toBeDefined();

    const dir = getRegionsDir();
    // Under pnpm the resolved path embeds the version, e.g.
    // .pnpm/@opuspopuli+regions@1.0.97/node_modules/@opuspopuli/regions/regions
    if (dir.includes(".pnpm")) {
      expect(dir).toContain(`@opuspopuli+regions@${declared}`);
    }
  });

  it("is stable across calls", () => {
    expect(getRegionsDir()).toBe(getRegionsDir());
  });
});

/**
 * The workspace-level invariant behind #1328. Two packages declaring the same
 * external version independently is undetectable at runtime — the loser is
 * simply whichever copy the walk does not reach — so it has to be caught here.
 */
describe("@opuspopuli/regions is declared exactly once in the workspace", () => {
  it("has a single declaring package", () => {
    const root = join(__dirname, "..", "..", "..");
    const manifests = [
      join(root, "package.json"),
      join(root, "apps", "backend", "package.json"),
      join(root, "apps", "frontend", "package.json"),
      ...readdirSync(join(root, "packages")).map((p) =>
        join(root, "packages", p, "package.json"),
      ),
    ].filter((p) => existsSync(p));

    const declaring = manifests.filter((p) => {
      const pkg = JSON.parse(readFileSync(p, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return Boolean(
        pkg.dependencies?.["@opuspopuli/regions"] ??
        pkg.devDependencies?.["@opuspopuli/regions"],
      );
    });

    expect(declaring.map((p) => p.replace(`${root}/`, ""))).toEqual([
      "packages/region-provider/package.json",
    ]);
  });
});
