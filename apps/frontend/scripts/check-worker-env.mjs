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
 * Runs as a postbuild step so it sees the real generated file.
 */

import fs from "node:fs";
import path from "node:path";

const ENV_SHIM = path.join(
  process.cwd(),
  ".open-next",
  "cloudflare",
  "next-env.mjs",
);

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
const PLACEHOLDER_PATTERNS = [
  /^your-super-secret/i,
  /^re_local_dummy/i,
  /placeholder/i,
  /^dev-frontend-secret/i,
];

/** Supabase demo JWTs carry `iss: "supabase-demo"`. Anything else is real. */
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

function isKnownPlaceholder(value) {
  const v = String(value ?? "").replace(/^['"]|['"]$/g, "");
  if (v === "") return true;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(v))) return true;
  return isSupabaseDemoJwt(v);
}

if (!fs.existsSync(ENV_SHIM)) {
  // Nothing to check — the Cloudflare build has not run.
  process.exit(0);
}

const source = fs.readFileSync(ENV_SHIM, "utf-8");
const offenders = new Map();
let blocksSeen = 0;

// One `export const <mode> = {...};` line per mode.
for (const match of source.matchAll(/export const (\w+) = (\{.*?\});?\n/gs)) {
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
if (blocksSeen === 0) {
  console.error(
    `\ncheck-worker-env: ${ENV_SHIM} exists but no 'export const <mode> = {...}'\n` +
      `blocks were found. @opennextjs/cloudflare has likely changed the shim\n` +
      `format, so this check can no longer verify it. Refusing to pass —\n` +
      `update the parser in this script rather than deleting the check.\n`,
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
