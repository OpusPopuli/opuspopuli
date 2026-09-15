import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findStaleBuilds } from "./build-freshness.js";

/**
 * The guard resolves packages relative to its own location, so these tests
 * build a throwaway workspace and check the mtime comparison directly against
 * it. What is under test is the staleness rule, not the path constant.
 */

const SECOND = 1000;

function makePackage(
  root: string,
  name: string,
  opts: { srcAt: number; distAt?: number },
): void {
  const pkg = join(root, name);
  const src = join(pkg, "src");
  mkdirSync(src, { recursive: true });
  const srcFile = join(src, "index.ts");
  writeFileSync(srcFile, "export const x = 1;\n");
  utimesSync(srcFile, opts.srcAt / SECOND, opts.srcAt / SECOND);
  utimesSync(src, opts.srcAt / SECOND, opts.srcAt / SECOND);

  if (opts.distAt !== undefined) {
    const dist = join(pkg, "dist");
    mkdirSync(dist, { recursive: true });
    const distFile = join(dist, "index.js");
    writeFileSync(distFile, "export const x = 1;\n");
    utimesSync(distFile, opts.distAt / SECOND, opts.distAt / SECOND);
    utimesSync(dist, opts.distAt / SECOND, opts.distAt / SECOND);
  }
}

describe("findStaleBuilds", () => {
  // Fixed timestamps: the rule is a comparison, and a test for it should not
  // depend on when it runs.
  const OLD = 1_700_000_000_000;
  const NEW = OLD + 600 * SECOND;

  test("flags a package whose source is newer than its build", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    makePackage(root, "embeddings-provider", { srcAt: NEW, distAt: OLD });

    const stale = findStaleBuilds(["embeddings-provider"], root);
    assert.equal(stale.length, 1);
    // This is the real-world case: a dist predating a src change, which is
    // exactly the Sep 7 build that silently disabled task prefixes.
    assert.ok(stale[0].srcNewerBy > 0);
  });

  test("accepts a build at least as new as its source", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    makePackage(root, "embeddings-provider", { srcAt: OLD, distAt: NEW });

    assert.deepEqual(findStaleBuilds(["embeddings-provider"], root), []);
  });

  test("treats a package that was never built as stale", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    makePackage(root, "llm-provider", { srcAt: OLD });

    const stale = findStaleBuilds(["llm-provider"], root);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].srcNewerBy, Infinity);
  });

  test("ignores a package that is not present", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    assert.deepEqual(findStaleBuilds(["does-not-exist"], root), []);
  });

  test("does not treat node_modules inside a package as its source", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    makePackage(root, "prompt-client", { srcAt: OLD, distAt: OLD + SECOND });

    // A dependency installed after the build must not read as a stale build.
    const nm = join(root, "prompt-client", "node_modules", "dep");
    mkdirSync(nm, { recursive: true });
    const depFile = join(nm, "index.js");
    writeFileSync(depFile, "module.exports = {};\n");
    utimesSync(depFile, NEW / SECOND, NEW / SECOND);

    assert.deepEqual(findStaleBuilds(["prompt-client"], root), []);
  });
});
