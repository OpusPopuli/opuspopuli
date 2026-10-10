#!/usr/bin/env node
/**
 * Check that every `pnpm.overrides` entry is still doing something.
 *
 * ## Why this exists
 *
 * The overrides block is the only mechanism this repo has for remediating a
 * transitive CVE. It is load-bearing for the pre-push and CI security gates,
 * and it has no test, no review trigger and no expiry. Both of its failure
 * modes are silent, and both fail in the direction that *looks* safe — a
 * reader scanning the block sees the package listed and concludes it is
 * handled (#1338).
 *
 *   stale VALUE   `sharp` was pinned at `>=0.35.4` while the advisory needed
 *                 `>=0.35.5`. The entry was present, the name was right, and
 *                 the audit failed anyway. Same shape as the `undici` entry a
 *                 day earlier.
 *
 *   inert KEY     a version-scoped key such as `next@>=16.0.0 <16.2.6` stops
 *                 matching anything once the tree moves past its range. The
 *                 override then does nothing, silently, and still reads as
 *                 protection.
 *
 * ## How it decides
 *
 * Deliberately no semver implementation and no new dependency. Range
 * arithmetic is where a checker like this would quietly get things wrong, so
 * the two questions it answers are the two that can be answered exactly:
 *
 *   1. Does the overridden package appear in the resolved tree at all?
 *      A pure name lookup against `pnpm-lock.yaml`. If the answer is no, the
 *      entry constrains nothing and is dead weight.
 *
 *   2. Does `pnpm audit` still flag a package that has an override?
 *      **Audit is the oracle.** It already knows the advisory's patched range
 *      and the installed version, so if it flags a package this block claims
 *      to have pinned, the pin is below what the advisory requires. That is
 *      the `sharp` case, detected with no range comparison at all.
 *
 * What it does NOT decide: whether a version-scoped key's range still matches.
 * That needs semver, so those entries are reported with the versions actually
 * resolved, for a human to judge. Guessing there would reintroduce exactly the
 * class of silent wrongness this script exists to surface.
 *
 * ## Usage
 *
 *   node scripts/check-overrides.mjs            # audit included (needs network)
 *   node scripts/check-overrides.mjs --no-audit # name checks only, offline
 *
 * Exits non-zero on a dead key or an override contradicted by audit.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_AUDIT = process.argv.includes('--no-audit');

/**
 * The package an override entry actually targets.
 *
 * pnpm accepts several shapes, and the target is not always the first token:
 *
 *   lodash                              -> lodash
 *   nanoid@<3.3.17                      -> nanoid
 *   jsdom>undici                        -> undici        (scoped to a parent)
 *   minimatch@>=10>brace-expansion      -> brace-expansion
 *   @apollo/gateway                     -> @apollo/gateway
 *
 * The last `>`-separated segment is the package being replaced; anything
 * before it only narrows where the replacement applies. A `@` inside the
 * segment separates a version selector — except at position 0, which is a
 * scope.
 *
 * The `>` cannot simply be split on, which is how the first version of this
 * got two of its three findings wrong: a comparator inside a range is also a
 * `>`, so `undici@>=7.0.0 <7.29.1` split into a "package" called
 * `=7.0.0 <7.29.1`, was absent from the tree, and was duly reported as an
 * inert key. A checker that invents findings is worse than no checker, because
 * it teaches you to stop reading it.
 *
 * A separator `>` is always followed by the start of a package name — a
 * letter, `@`, or `_`. A comparator `>` is followed by `=` or a digit. That
 * distinction is exact for every form pnpm accepts, including the mixed
 * `minimatch@>=10>brace-expansion`, where the first `>` is a comparator and
 * the second is a separator.
 */
const PARENT_SEPARATOR = />(?=[@a-zA-Z_])/;

function parseOverrideKey(key) {
  const segment = key.split(PARENT_SEPARATOR).pop().trim();
  const at = segment.indexOf('@', 1);
  return at === -1
    ? { name: segment, selector: null }
    : { name: segment.slice(0, at), selector: segment.slice(at + 1) };
}

/**
 * Every `name -> Set<version>` in the resolved tree, from the lockfile's
 * `packages:` section.
 *
 * Read from the lockfile rather than from `pnpm list` because it is the
 * artifact CI installs from, it needs no install to inspect, and it is the
 * thing a reviewer is looking at when they trust the overrides block.
 */
function resolvedPackages() {
  const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  const start = lock.indexOf('\npackages:\n');
  if (start === -1) throw new Error('pnpm-lock.yaml has no packages: section');
  // `snapshots:` repeats the same specs with peer resolutions; one pass over
  // `packages:` is enough and avoids counting each package twice.
  const end = lock.indexOf('\nsnapshots:\n', start);
  const body = lock.slice(start, end === -1 ? undefined : end);

  const versions = new Map();
  for (const line of body.split('\n')) {
    const m = /^ {2}'?([^':\s]+)'?:$/.exec(line);
    if (!m) continue;
    // Strip a peer-dependency suffix: `pkg@1.0.0(react@19.0.0)`.
    const spec = m[1].replace(/\(.*\)$/, '');
    const at = spec.lastIndexOf('@');
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(version);
  }
  return versions;
}

/** Package names `pnpm audit` still reports at high or critical. */
function auditFlaggedPackages() {
  let raw;
  try {
    raw = execFileSync(
      'pnpm',
      ['audit', '--prod', '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // pnpm audit exits non-zero when it FINDS things, so stdout is still the
    // result. Only a missing/garbled stdout means it genuinely could not run —
    // which must not read as "clean", for the same reason the pre-push hook
    // distinguishes a transport failure from a verdict.
    raw = e.stdout;
    if (!raw) {
      return { ok: false, flagged: new Map() };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, flagged: new Map() };
  }

  const flagged = new Map();
  for (const a of Object.values(parsed.advisories ?? {})) {
    if (a.severity !== 'high' && a.severity !== 'critical') continue;
    if (!flagged.has(a.module_name)) flagged.set(a.module_name, []);
    flagged.get(a.module_name).push({
      severity: a.severity,
      vulnerable: a.vulnerable_versions,
      patched: a.patched_versions,
      ghsa: a.github_advisory_id,
    });
  }
  return { ok: true, flagged };
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const overrides = pkg.pnpm?.overrides ?? {};
  const entries = Object.entries(overrides);
  if (entries.length === 0) {
    console.log('No pnpm.overrides to check.');
    return 0;
  }

  const resolved = resolvedPackages();
  const audit = SKIP_AUDIT ? { ok: true, flagged: new Map() } : auditFlaggedPackages();

  const dead = [];
  const contradicted = [];
  const needsReview = [];

  for (const [key, value] of entries) {
    const { name, selector } = parseOverrideKey(key);
    const found = resolved.get(name);

    if (!found) {
      dead.push({ key, value, name });
      continue;
    }

    const flags = audit.flagged.get(name);
    if (flags) {
      contradicted.push({ key, value, name, flags });
    }

    if (selector) {
      needsReview.push({
        key,
        value,
        name,
        selector,
        resolved: [...found].sort(),
      });
    }
  }

  console.log(
    `Checked ${entries.length} pnpm.overrides entries against ` +
      `${resolved.size} resolved packages.\n`,
  );

  if (contradicted.length > 0) {
    console.log('STALE VALUE — audit still flags a package this block pins:');
    for (const c of contradicted) {
      const versions = [...resolved.get(c.name)].sort().join(', ');
      console.log(`  ${c.key}: ${c.value}`);
      console.log(`    resolved: ${versions}`);
      for (const f of c.flags) {
        console.log(
          `    ${f.severity.toUpperCase()} ${f.ghsa ?? ''} vulnerable ` +
            `${f.vulnerable} -> needs ${f.patched}`,
        );
      }
    }
    console.log(
      '\n  The entry exists and reads as covered, but the pinned value is ' +
        'below\n  what the advisory requires. Raise it to the patched range.\n',
    );
  }

  if (dead.length > 0) {
    console.log('INERT KEY — the overridden package is not in the tree:');
    for (const d of dead) console.log(`  ${d.key}: ${d.value}`);
    console.log(
      '\n  These constrain nothing. Either the dependency is gone and the ' +
        'entry\n  should be removed, or the key is misspelled and the ' +
        'protection it\n  claims to provide was never applied.\n',
    );
  }

  if (needsReview.length > 0) {
    console.log(
      `VERSION-SCOPED (${needsReview.length}) — range not checked here, ` +
        'verify by eye:',
    );
    for (const r of needsReview) {
      console.log(
        `  ${r.key}\n    selector ${r.selector} | resolved ${r.resolved.join(', ')}`,
      );
    }
    console.log(
      '\n  A selector that no longer matches any resolved version makes the ' +
        'entry\n  inert while still reading as protection. Deciding that ' +
        'needs semver, which\n  this script deliberately does not ' +
        'implement.\n',
    );
  }

  if (!audit.ok) {
    console.log(
      'WARNING: pnpm audit did not produce a verdict, so the stale-value ' +
        'check\ndid not run. This is NOT a clean result — no advisory was ' +
        'consulted.\n',
    );
  }

  const failures = contradicted.length + dead.length;
  if (failures === 0) {
    console.log(
      'OK: every override targets a package in the tree, and none of them ' +
        'is\ncontradicted by an advisory.',
    );
  }
  return failures > 0 ? 1 : 0;
}

/**
 * Assertions over the parsing and decision logic, runnable with `--self-test`.
 *
 * Here because the first version of this script shipped a parser that split on
 * every `>`, including the comparator inside a version range, and reported two
 * invented "inert key" findings as a result. A checker whose own logic is
 * unverified has no business telling anyone their security config is wrong.
 */
function selfTest() {
  const cases = [
    ['lodash', 'lodash', null],
    ['@apollo/gateway', '@apollo/gateway', null],
    ['nanoid@<3.3.17', 'nanoid', '<3.3.17'],
    // The comparator `>` must not be read as a parent separator.
    ['undici@>=7.0.0 <7.29.1', 'undici', '>=7.0.0 <7.29.1'],
    ['next@>=16.0.0 <16.2.6', 'next', '>=16.0.0 <16.2.6'],
    // Parent-scoped: the target is the last segment.
    ['jsdom>undici', 'undici', null],
    ['@opennextjs/aws>path-to-regexp', 'path-to-regexp', null],
    // Both forms at once: first `>` is a comparator, second is a separator.
    ['minimatch@>=10>brace-expansion', 'brace-expansion', null],
  ];

  let failures = 0;
  for (const [key, name, selector] of cases) {
    const got = parseOverrideKey(key);
    if (got.name !== name || got.selector !== selector) {
      console.log(
        `  FAIL ${key}\n    expected name=${name} selector=${selector}` +
          `\n    got      name=${got.name} selector=${got.selector}`,
      );
      failures++;
    }
  }

  // A parsed name can never contain a comparator or a space; that is the
  // invariant the original bug violated. Assert it across the real block too,
  // so a future override in a shape not covered above still trips this.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const key of Object.keys(pkg.pnpm?.overrides ?? {})) {
    const { name } = parseOverrideKey(key);
    if (/[<>=\s]/.test(name)) {
      console.log(`  FAIL real key ${key} parsed to name "${name}"`);
      failures++;
    }
  }

  console.log(
    failures === 0
      ? `self-test OK (${cases.length} cases + every key in the real block)`
      : `self-test FAILED: ${failures}`,
  );
  return failures > 0 ? 1 : 0;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : main());
