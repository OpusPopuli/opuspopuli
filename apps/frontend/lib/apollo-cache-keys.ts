/**
 * localStorage keys for the persisted Apollo cache.
 *
 * In their own module so `auth-logout.ts` can purge the cache without
 * importing `apollo-client.ts` — that import would be circular, since
 * apollo-client imports auth-logout for the expired-session handler.
 */

/**
 * Bump the version suffix whenever a non-backward-compatible schema change
 * ships, so existing clients drop stale entries on next load rather than
 * serving them while the network result arrives. See #747.
 */
export const APOLLO_CACHE_KEY = "apollo-cache-persist-v2";

/** Superseded keys, removed on boot so they cannot accumulate. */
export const LEGACY_APOLLO_CACHE_KEYS = ["apollo-cache-persist"];

/**
 * Drop the persisted cache from storage.
 *
 * MUST be called whenever the signed-in identity changes. Apollo persists every
 * query result — including `myProfile`, `myAddresses` and `mySignalProfile` —
 * and restores them on the next page load. Apollo's default policy is
 * cache-first, so without this the next person to sign in on the same browser
 * is shown the previous user's address, jurisdiction and personalization
 * signals, straight from disk, before any network request happens.
 *
 * Storage can be unavailable (private mode, quota), and a failure here must
 * never block signing out — so this swallows errors rather than throwing into
 * an auth path.
 */
export function purgePersistedCache(): void {
  try {
    globalThis.localStorage?.removeItem(APOLLO_CACHE_KEY);
    for (const key of LEGACY_APOLLO_CACHE_KEYS) {
      globalThis.localStorage?.removeItem(key);
    }
  } catch {
    // Non-fatal: the in-memory cache is still cleared by the caller, and the
    // worst case is a stale entry that the next schema bump removes anyway.
  }
}

/**
 * In-memory cache reset, registered by `apollo-client` at module init.
 *
 * A registry rather than a direct import, because importing apollo-client from
 * here — or from auth-context — closes a cycle:
 * apollo-client → auth-refresh-link → auth-logout → auth-context. That cycle
 * is not theoretical; it throws `Cannot access 'sessionRefreshLink' before
 * initialization` at load. `auth-logout.ts` already documents the same hazard.
 *
 * This module imports nothing, so anything may depend on it safely.
 */
let resetInMemoryCache: (() => Promise<void>) | null = null;

/** Called once by apollo-client. Not for application code. */
export function registerCacheReset(reset: () => Promise<void>): void {
  resetInMemoryCache = reset;
}

/**
 * Clear the cache — in memory AND on disk — because the signed-in identity is
 * changing. Call this on logout, on session expiry, and when a different user
 * signs in.
 */
export async function clearIdentityScopedCache(): Promise<void> {
  purgePersistedCache();
  try {
    await resetInMemoryCache?.();
  } catch {
    // Cache teardown must never block a sign-out.
  }
  // Again: the persistor may have written the cache back out between the two
  // steps. An empty file is harmless; a stale one is the bug.
  purgePersistedCache();
}
