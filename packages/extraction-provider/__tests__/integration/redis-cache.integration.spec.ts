/**
 * Redis Cache Integration Tests
 *
 * Tests the RedisCache implementation against a real Redis instance.
 */
import { RedisCache } from "../../src/cache/redis-cache";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

describe("RedisCache (Integration)", () => {
  let cache: RedisCache<{ data: string }>;

  beforeEach(async () => {
    cache = new RedisCache<{ data: string }>({
      url: REDIS_URL,
      keyPrefix: "test:cache:",
      ttlMs: 60000, // 1 minute
    });
    // Clear any previous test data
    await cache.clear();
  });

  afterEach(async () => {
    await cache.clear();
    await cache.destroy();
  });

  describe("connection", () => {
    it("should connect to Redis and respond to ping", async () => {
      const result = await cache.ping();
      expect(result).toBe(true);
    });

    it("should report ready state after connection", async () => {
      await cache.ping(); // Force connection
      expect(cache.isReady()).toBe(true);
    });
  });

  describe("get/set operations", () => {
    it("should store and retrieve values", async () => {
      await cache.set("key1", { data: "value1" });
      const result = await cache.get("key1");
      expect(result).toEqual({ data: "value1" });
    });

    it("should return undefined for non-existent keys", async () => {
      const result = await cache.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should handle complex objects", async () => {
      const complex = {
        data: "test",
        nested: { a: 1, b: [1, 2, 3] },
      };
      await cache.set("complex", complex as unknown as { data: string });
      const result = await cache.get("complex");
      expect(result).toEqual(complex);
    });

    it("should overwrite existing values", async () => {
      await cache.set("key", { data: "first" });
      await cache.set("key", { data: "second" });
      const result = await cache.get("key");
      expect(result).toEqual({ data: "second" });
    });
  });

  describe("has operation", () => {
    it("should return true for existing keys", async () => {
      await cache.set("exists", { data: "value" });
      const result = await cache.has("exists");
      expect(result).toBe(true);
    });

    it("should return false for non-existent keys", async () => {
      const result = await cache.has("doesnotexist");
      expect(result).toBe(false);
    });
  });

  describe("delete operation", () => {
    it("should delete existing keys", async () => {
      await cache.set("todelete", { data: "value" });
      const deleted = await cache.delete("todelete");
      expect(deleted).toBe(true);

      const result = await cache.get("todelete");
      expect(result).toBeUndefined();
    });

    it("should return false when deleting non-existent keys", async () => {
      const deleted = await cache.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("clear operation", () => {
    it("should clear all keys with prefix", async () => {
      await cache.set("key1", { data: "v1" });
      await cache.set("key2", { data: "v2" });
      await cache.set("key3", { data: "v3" });

      await cache.clear();

      expect(await cache.has("key1")).toBe(false);
      expect(await cache.has("key2")).toBe(false);
      expect(await cache.has("key3")).toBe(false);
    });
  });

  describe("size and keys operations", () => {
    it("should return correct size", async () => {
      expect(await cache.size).toBe(0);

      await cache.set("a", { data: "1" });
      await cache.set("b", { data: "2" });
      await cache.set("c", { data: "3" });

      expect(await cache.size).toBe(3);
    });

    it("should return all keys", async () => {
      await cache.set("key1", { data: "1" });
      await cache.set("key2", { data: "2" });

      const keys = await cache.keys();
      expect(keys.sort()).toEqual(["key1", "key2"]);
    });
  });

  describe("TTL expiration", () => {
    it("should expire keys after TTL", async () => {
      const shortTtlCache = new RedisCache<{ data: string }>({
        url: REDIS_URL,
        keyPrefix: "test:ttl:",
        ttlMs: 1000, // 1 second
      });

      await shortTtlCache.set("expiring", { data: "value" });
      expect(await shortTtlCache.get("expiring")).toEqual({ data: "value" });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(await shortTtlCache.get("expiring")).toBeUndefined();

      await shortTtlCache.destroy();
    }, 10000);
  });

  describe("key prefixing", () => {
    it("should isolate different cache instances with different prefixes", async () => {
      const cache2 = new RedisCache<{ data: string }>({
        url: REDIS_URL,
        keyPrefix: "test:other:",
      });

      await cache.set("shared", { data: "from cache1" });
      await cache2.set("shared", { data: "from cache2" });

      expect(await cache.get("shared")).toEqual({ data: "from cache1" });
      expect(await cache2.get("shared")).toEqual({ data: "from cache2" });

      await cache2.destroy();
    });
  });
});
