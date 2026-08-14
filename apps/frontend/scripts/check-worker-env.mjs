#!/usr/bin/env node
/**
 * Fails the build if anything other than a NEXT_PUBLIC_* key reaches the
 * Cloudflare Worker bundle.
 *
 * Why this exists: @opennextjs/cloudflare's `extractProjectEnvVars()` reads
 * `.env`, `.env.{mode}`, `.env.local` and `.env.{mode}.local` — and in a
 * monorepo it reads each of those from the REPOSITORY ROOT as well as the app
 * directory. It merges everything and writes it to
 * `.open-next/cloudflare/next-env.mjs` with **no NEXT_PUBLIC_ filter**, so any
 * key present in a root .env is embedded in a deployed artifact. There is no
 * option to disable it; the behaviour is unconditional in
 * `dist/cli/build/open-next/compile-env-files.js`.
 *
 * On 2026-08-13 that shipped a real GitHub PAT and an API key into a deployed
 * Worker, alongside five local-dev placeholders. Nothing warned, and nothing in
 * CI could have caught it — the file is generated at build time and gitignored.
 * It was found only by reading the bundle by hand.
 *
 * The values were not publicly fetchable (the shim is bundled into the Worker
 * script, not into `.open-next/assets/`, and every path returns 404). But
 * "not reachable today" is a property of how OpenNext happens to bundle, not a
 * guarantee — and a credential in a build artifact is worth failing over
 * regardless of who can currently read it.
 *
 * Chained after the Cloudflare build in the `cf:*` scripts (there is no npm
 * `postbuild` hook involved) so it inspects the real generated file. `cf:preview`
 * and `cf:deploy` both go through `cf:build` rather than repeating the
 * invocation, so the guard cannot be dropped from one path while surviving in
 * the others -- which is the realistic way this kind of protection decays.
 */
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file's own location, NOT process.cwd().
//
// With cwd, running `node apps/frontend/scripts/check-worker-env.mjs` from the
// repo root looked for `<root>/.open-next/`, found nothing, and exited 0 --
// silently, while a shim full of real values sat in apps/frontend. A guard that
// reports success because it was invoked from the wrong directory is worse than
// no guard. `pnpm check:worker-env` is a bare hand-runnable entrypoint, so that
// invocation is invited rather than exotic.
//
// The script lives at apps/frontend/scripts/, so ../.. is the frontend app root
// and the answer is the same from any cwd.
const APP_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const BUILD_DIR = path.join(APP_ROOT, ".open-next");
const ENV_SHIM = path.join(BUILD_DIR, "cloudflare", "next-env.mjs");

// Keys that are legitimately non-public and harmless to inline. NEXTJS_ENV is
// written by OpenNext itself to select the mode.
const ALLOWED_NON_PUBLIC = new Set(["NEXTJS_ENV"]);

/**
 * The repository-root `.env` has to keep local-dev values for docker-compose,
 * which auto-loads it — so a few non-public keys will always reach the bundle.
 *
 * They are allowed BY VALUE, not by name. Allowing `JWT_SECRET` by name would
 * gut this check: the day someone pastes a real secret over the placeholder,
 * it ships and nothing complains. Matching the value means the placeholder
 * passes and anything else fails, which is the property actually worth having.
 *
 * Every pattern below is a documented public default:
 *   - `your-super-secret-…`   Supabase's published local-development defaults
 *   - `re_local_dummy…`       a deliberately inert Resend key
 *   - `supabase-demo` JWTs    signed by the default secret above, so they grant
 *                             nothing beyond a local stack
 */
// All anchored at the start. An unanchored pattern would match a real
// credential that merely CONTAINS the word -- a connection string with a live
// password and a host like db.placeholder.internal would sail through a bare
// /placeholder/i. Anchoring means a value has to *begin* as a known public
// default to be excused.
const PLACEHOLDER_PATTERNS = [
  /^your-super-secret/i,
  /^re_local_dummy/i,
  /^placeholder/i,
  /^dev-frontend-secret/i,
];

/**
 * Supabase demo JWTs carry `iss: "supabase-demo"`. Anything else is real.
 *
 * The signature is deliberately not verified. This guards against an accident
 * -- someone pasting a live credential into a .env -- and for one to slip
 * through here it would have to be a well-formed JWT whose payload claims
 * `supabase-demo`, which real project keys (`iss: "supabase"`) never do.
 * Forging that takes intent, and anyone with intent can edit this file.
 *
 * Both failure paths return false, so an unparseable value is treated as real
 * and fails the build.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isSupabaseDemoJwt(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf-8"),
    );
    return payload.iss === "supabase-demo";
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean} true if the value is a documented public default, and so
 *   carries no secret material even though its key name may sound like it does.
 */
function isKnownPlaceholder(value) {
  const v = String(value ?? "").replace(/^['"]|['"]$/g, "");
  if (v === "") return true;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(v))) return true;
  return isSupabaseDemoJwt(v);
}

// A missing shim is ambiguous, and the two cases pull opposite ways.
//
// If there is no build output at all, there is genuinely nothing to check and
// passing is right -- `pnpm check:worker-env` on a clean tree should not fail.
//
// But if `.open-next/` exists and the shim inside it does not, OpenNext has
// moved or renamed the file and this script is now looking at nothing. Exiting
// 0 there is the same silent fail-open closed off below for an unrecognisable
// format, and it is the more likely of the two: the dependency is pinned `^`,
// so a minor upgrade arrives on any `pnpm install` without anyone deciding to
// take it.
//
// The original version of this check exited 0 here without printing anything,
// which is the worst shape -- no "ok", no error, so a deploy log offers no
// evidence either way about whether the guard ran.
if (!fs.existsSync(ENV_SHIM)) {
  if (fs.existsSync(BUILD_DIR)) {
    console.error(
      `\ncheck-worker-env: ${BUILD_DIR} exists but ${ENV_SHIM} does not.\n` +
        `@opennextjs/cloudflare has likely moved or renamed the env shim, so\n` +
        `this check can no longer find what it is meant to inspect. Refusing to\n` +
        `pass -- point this script at the new location rather than removing it.\n`,
    );
    process.exit(1);
  }
  console.log(
    "check-worker-env: no Cloudflare build output — nothing to check.",
  );
  process.exit(0);
}

const source = fs.readFileSync(ENV_SHIM, "utf-8");
const offenders = new Map();
let blocksSeen = 0;

// Count the declarations independently of parsing them, so that a block this
// script fails to parse is detected rather than passed over. Matching only
// `\n`-terminated blocks meant a final block with no trailing newline was
// skipped in silence -- and `blocksSeen === 0` could not catch it, because the
// earlier blocks had matched. The generator always appends `;\n` today, so this
// is drift insurance, not a live bug.
const declared = [...source.matchAll(/^export const \w+ = /gm)].length;

// One `export const <mode> = {...};` line per mode. `$` accepts a block that
// ends at EOF without a trailing newline.
for (const match of source.matchAll(
  /export const (\w+) = (\{.*?\});?(?:\n|$)/gs,
)) {
  const [, mode, json] = match;
  blocksSeen++;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error(
      `check-worker-env: could not parse the '${mode}' block of ${ENV_SHIM}.\n` +
        `Refusing to pass — an unreadable env shim cannot be verified safe.`,
    );
    process.exit(1);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith("NEXT_PUBLIC_")) continue;
    if (ALLOWED_NON_PUBLIC.has(key)) continue;
    // Allowed by VALUE — a real credential under one of these names still fails.
    if (isKnownPlaceholder(value)) continue;
    if (!offenders.has(key)) offenders.set(key, new Set());
    offenders.get(key).add(mode);
  }
}

// Fail closed. The shim exists but nothing matched the expected
// `export const <mode> = {...}` shape, so this script is reading a format it
// was not written for and cannot make any claim about what it contains.
// Reporting "ok" here would be the worst outcome: the guard keeps passing for
// years while silently checking nothing.
if (blocksSeen === 0 || blocksSeen !== declared) {
  const detail =
    blocksSeen === 0
      ? `no 'export const <mode> = {...}' blocks were found`
      : `${declared} block(s) are declared but only ${blocksSeen} could be parsed`;
  console.error(
    `\ncheck-worker-env: ${ENV_SHIM} exists but ${detail}.\n` +
      `@opennextjs/cloudflare has likely changed the shim format, so this check\n` +
      `can no longer verify all of it. Refusing to pass — update the parser in\n` +
      `this script rather than deleting the check.\n`,
  );
  process.exit(1);
}

if (offenders.size === 0) {
  console.log(
    "check-worker-env: ok — only NEXT_PUBLIC_* values reached the Worker bundle.",
  );
  process.exit(0);
}

console.error(
  `\ncheck-worker-env: ${offenders.size} non-public key(s) would be embedded in the Worker:\n`,
);
for (const [key, modes] of offenders) {
  console.error(`  ${key}  (${[...modes].join(", ")})`);
}
console.error(
  [
    "",
    "These come from a .env file that OpenNext inlines — including the",
    "MONOREPO-ROOT .env, not just apps/frontend/. Values are NOT printed here,",
    "deliberately: this output may end up in CI logs.",
    "",
    "To fix, move each key out of every .env file OpenNext reads:",
    "  <root>/.env  <root>/.env.production  <root>/.env.local  <root>/.env.production.local",
    "  apps/frontend/.env  (and the same variants)",
    "",
    "Backend credentials belong in apps/backend/.env. npm auth belongs in",
    "~/.npmrc or your shell profile — OpenNext reads .env FILES, never",
    "process.env, so an exported variable is never captured.",
    "",
  ].join("\n"),
);
process.exit(1);
