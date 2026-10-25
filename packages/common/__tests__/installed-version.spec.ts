import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedVersion } from "../src/utils/installed-version";

/**
 * What a parse key is built from (propositions Phase B, K-P1). If this
 * returned undefined for everything, every key would still be stable and
 * every test elsewhere would pass — while a dependency bump silently stopped
 * re-parsing. So it is checked against a real resolution.
 */
describe("installedVersion", () => {
  let root: string;
  let from: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "installed-version-"));
    const pkg = join(root, "node_modules", "hidden-manifest");
    mkdirSync(pkg, { recursive: true });
    // An `exports` map that hides package.json — as pdf-parse and mupdf do.
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "hidden-manifest",
        version: "4.5.6",
        exports: { ".": "./index.js" },
      }),
    );
    writeFileSync(join(pkg, "index.js"), "module.exports = {};");
    from = join(root, "caller.js");
    writeFileSync(from, "");
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads the version a package's exports map hides, as the caller resolves it", () => {
    expect(installedVersion("hidden-manifest", from)).toBe("4.5.6");
  });

  it("is undefined for a package the caller cannot resolve", () => {
    expect(installedVersion("no-such-package-anywhere", from)).toBeUndefined();
  });
});
