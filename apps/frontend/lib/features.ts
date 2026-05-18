/**
 * Feature flags driven by environment variables.
 * All NEXT_PUBLIC_* vars are inlined at build time.
 *
 * AUTH_FULL_OPTIONS — when true, passkey + password sign-in are visible
 * alongside magic link. Default off for launch; flip to re-enable without
 * a code deploy. Set NEXT_PUBLIC_AUTH_FULL_OPTIONS=true in .env.local.
 * See issue #671 for the re-enable checklist.
 */
export const AUTH_FULL_OPTIONS =
  process.env.NEXT_PUBLIC_AUTH_FULL_OPTIONS === "true";
