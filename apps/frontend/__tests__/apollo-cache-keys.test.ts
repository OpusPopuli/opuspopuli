import {
  APOLLO_CACHE_KEY,
  LEGACY_APOLLO_CACHE_KEYS,
  purgePersistedCache,
} from "../lib/apollo-cache-keys";

/**
 * The failure this guards against is a privacy one, not a crash.
 *
 * Apollo persists every query result — including myProfile, myAddresses and
 * mySignalProfile — and restores them on the next page load. Apollo is
 * cache-first by default, so a persisted cache that outlives its owner is
 * rendered to whoever signs in next, from disk, before any network request.
 */
describe("purgePersistedCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes the current persisted cache", () => {
    localStorage.setItem(APOLLO_CACHE_KEY, '{"myProfile":{"email":"a@b.c"}}');

    purgePersistedCache();

    expect(localStorage.getItem(APOLLO_CACHE_KEY)).toBeNull();
  });

  // A user who signed in before the key was versioned still has the old entry.
  // Leaving it behind would keep exactly the data this is meant to remove.
  it("removes superseded cache keys too", () => {
    for (const key of LEGACY_APOLLO_CACHE_KEYS) {
      localStorage.setItem(key, '{"stale":true}');
    }

    purgePersistedCache();

    for (const key of LEGACY_APOLLO_CACHE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("leaves unrelated keys alone", () => {
    localStorage.setItem("op-theme", "dark");
    localStorage.setItem(APOLLO_CACHE_KEY, "{}");

    purgePersistedCache();

    expect(localStorage.getItem("op-theme")).toBe("dark");
  });

  // Storage throws in private mode and on quota errors. This runs inside
  // sign-out, so throwing here would strand a user mid-logout — worse than a
  // stale cache entry.
  it("never throws when storage is unavailable", () => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = jest.fn(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => purgePersistedCache()).not.toThrow();

    Storage.prototype.removeItem = original;
  });

  it("is safe to call when nothing is cached", () => {
    expect(() => purgePersistedCache()).not.toThrow();
    expect(localStorage.getItem(APOLLO_CACHE_KEY)).toBeNull();
  });
});
