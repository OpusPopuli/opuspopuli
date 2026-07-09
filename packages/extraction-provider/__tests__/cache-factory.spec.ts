/**
 * CacheFactory + FallbackCache unit tests.
 *
 * Covers the #725 Redis split: getRedisUrlFromEnv/getProviderFromEnv honoring
 * REDIS_CACHE_URL with fallback to REDIS_URL, and FallbackCache auto-recovery
 * (a transient primary outage must not pin the cache to memory permanently).
 */

import type { ICache } from "@opuspopuli/common";
import { CacheFactory, FallbackCache } from "../src/cache/cache-factory";

describe("CacheFactory env resolution (#725)", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("prefers REDIS_CACHE_URL over REDIS_URL for the cache", () => {
    process.env.REDIS_URL = "redis://queue:6379";
    process.env.REDIS_CACHE_URL = "redis://cache:6379";
    expect(CacheFactory.getRedisUrlFromEnv()).toBe("redis://cache:6379");
  });

  it("falls back to REDIS_URL when REDIS_CACHE_URL is unset", () => {
    delete process.env.REDIS_CACHE_URL;
    process.env.REDIS_URL = "redis://queue:6379";
    expect(CacheFactory.getRedisUrlFromEnv()).toBe("redis://queue:6379");
  });

  it("returns undefined when neither is set", () => {
    delete process.env.REDIS_CACHE_URL;
    delete process.env.REDIS_URL;
    expect(CacheFactory.getRedisUrlFromEnv()).toBeUndefined();
  });

  it("selects the redis provider when either URL is present", () => {
    delete process.env.REDIS_URL;
    process.env.REDIS_CACHE_URL = "redis://cache:6379";
    expect(CacheFactory.getProviderFromEnv()).toBe("redis");
    delete process.env.REDIS_CACHE_URL;
    process.env.REDIS_URL = "redis://queue:6379";
    expect(CacheFactory.getProviderFromEnv()).toBe("redis");
  });

  it("selects the memory provider when neither URL is present", () => {
    delete process.env.REDIS_CACHE_URL;
    delete process.env.REDIS_URL;
    expect(CacheFactory.getProviderFromEnv()).toBe("memory");
  });
});

/** Minimal in-memory ICache whose get() can be toggled to throw. */
class ControllableCache implements ICache<string> {
  failing = false;
  private store = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    if (this.failing) throw new Error("primary down");
    return this.store.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    if (this.failing) throw new Error("primary down");
    this.store.set(key, value);
  }
  async has(key: string): Promise<boolean> {
    if (this.failing) throw new Error("primary down");
    return this.store.has(key);
  }
  async delete(key: string): Promise<boolean> {
    if (this.failing) throw new Error("primary down");
    return this.store.delete(key);
  }
  async clear(): Promise<void> {
    this.store.clear();
  }
  get size(): number {
    return this.store.size;
  }
  async keys(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async destroy(): Promise<void> {
    this.store.clear();
  }
}

describe("FallbackCache auto-recovery (#725)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("serves from fallback after the primary fails", async () => {
    const primary = new ControllableCache();
    const fallback = new ControllableCache();
    const cache = new FallbackCache<string>(primary, fallback, 30_000);

    primary.failing = true;
    await cache.set("k", "v"); // fails on primary → routed to fallback
    expect(cache.isUsingFallback()).toBe(true);
    expect(await fallback.get("k")).toBe("v");
  });

  it("stays on fallback during the cooldown window", async () => {
    const primary = new ControllableCache();
    const fallback = new ControllableCache();
    const cache = new FallbackCache<string>(primary, fallback, 30_000);

    primary.failing = true;
    await cache.get("k"); // trips fallback
    primary.failing = false; // primary "recovers" immediately...

    jest.advanceTimersByTime(10_000); // ...but only 10s elapse (< 30s cooldown)
    const probe = jest.spyOn(primary, "get");
    await cache.get("k");
    expect(probe).not.toHaveBeenCalled(); // did not re-probe the primary yet
    expect(cache.isUsingFallback()).toBe(true);
  });

  it("re-probes and recovers to the primary after the cooldown", async () => {
    const primary = new ControllableCache();
    const fallback = new ControllableCache();
    const cache = new FallbackCache<string>(primary, fallback, 30_000);

    primary.failing = true;
    await cache.get("k"); // trips fallback
    primary.failing = false;

    jest.advanceTimersByTime(30_000); // cooldown elapsed
    await cache.get("k"); // probes primary, which now succeeds
    expect(cache.isUsingFallback()).toBe(false);
  });
});
