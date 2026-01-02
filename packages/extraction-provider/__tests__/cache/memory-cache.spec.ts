import { MemoryCache } from "../../src/cache/memory-cache";

describe("MemoryCache", () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new MemoryCache({ ttlMs: 5000, maxSize: 3 });
  });

  afterEach(() => {
    cache.destroy();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should create cache with default options", () => {
      const defaultCache = new MemoryCache();
      expect(defaultCache).toBeDefined();
      expect(defaultCache.size).toBe(0);
      defaultCache.destroy();
    });

    it("should create cache with custom options", () => {
      expect(cache).toBeDefined();
      expect(cache.size).toBe(0);
    });
  });

  describe("set and get", () => {
    it("should store and retrieve values", () => {
      cache.set("key1", "value1");

      expect(cache.get("key1")).toBe("value1");
    });

    it("should return undefined for non-existent keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should overwrite existing values", () => {
      cache.set("key1", "value1");
      cache.set("key1", "value2");

      expect(cache.get("key1")).toBe("value2");
      expect(cache.size).toBe(1);
    });

    it("should handle different value types", () => {
      const objectCache = new MemoryCache<{ name: string }>();
      objectCache.set("user", { name: "John" });

      expect(objectCache.get("user")).toEqual({ name: "John" });
      objectCache.destroy();
    });
  });

  describe("TTL expiration", () => {
    it("should return undefined for expired entries", () => {
      cache.set("key1", "value1");

      // Advance time past TTL
      jest.advanceTimersByTime(6000);

      expect(cache.get("key1")).toBeUndefined();
    });

    it("should return value before expiration", () => {
      cache.set("key1", "value1");

      // Advance time but not past TTL
      jest.advanceTimersByTime(4000);

      expect(cache.get("key1")).toBe("value1");
    });

    it("should support custom TTL per entry", () => {
      cache.set("short", "value1", 1000);
      cache.set("long", "value2", 10000);

      // Advance past short TTL but before long TTL
      jest.advanceTimersByTime(2000);

      expect(cache.get("short")).toBeUndefined();
      expect(cache.get("long")).toBe("value2");
    });
  });

  describe("has", () => {
    it("should return true for existing non-expired keys", () => {
      cache.set("key1", "value1");

      expect(cache.has("key1")).toBe(true);
    });

    it("should return false for non-existent keys", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("should return false for expired keys", () => {
      cache.set("key1", "value1");

      jest.advanceTimersByTime(6000);

      expect(cache.has("key1")).toBe(false);
    });

    it("should delete expired keys when checking", () => {
      cache.set("key1", "value1");

      jest.advanceTimersByTime(6000);

      cache.has("key1");
      expect(cache.size).toBe(0);
    });
  });

  describe("delete", () => {
    it("should remove existing key", () => {
      cache.set("key1", "value1");

      const result = cache.delete("key1");

      expect(result).toBe(true);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("should return false for non-existent key", () => {
      const result = cache.delete("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
    });
  });

  describe("max size eviction", () => {
    it("should evict oldest entry when max size reached", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      // Adding 4th entry should evict key1
      cache.set("key4", "value4");

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");
      expect(cache.get("key4")).toBe("value4");
      expect(cache.size).toBe(3);
    });

    it("should not evict when updating existing key", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      // Updating existing key should not evict
      cache.set("key1", "updated");

      expect(cache.get("key1")).toBe("updated");
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");
      expect(cache.size).toBe(3);
    });
  });

  describe("keys", () => {
    it("should return all keys", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const keys = cache.keys();

      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys.length).toBe(2);
    });

    it("should return empty array for empty cache", () => {
      expect(cache.keys()).toEqual([]);
    });
  });

  describe("cleanup", () => {
    it("should remove all expired entries", () => {
      cache.set("key1", "value1", 1000);
      cache.set("key2", "value2", 10000);
      cache.set("key3", "value3", 2000);

      jest.advanceTimersByTime(3000);

      cache.cleanup();

      expect(cache.size).toBe(1);
      expect(cache.get("key2")).toBe("value2");
    });

    it("should run automatically on interval", () => {
      cache.set("key1", "value1", 120000); // 2 minute TTL

      // Advance past cleanup interval (60s) but before TTL
      jest.advanceTimersByTime(61000);

      // Entry should still exist since TTL not reached
      expect(cache.get("key1")).toBe("value1");
    });
  });

  describe("destroy", () => {
    it("should clear cache and stop cleanup interval", () => {
      cache.set("key1", "value1");

      cache.destroy();

      expect(cache.size).toBe(0);
    });

    it("should be safe to call multiple times", () => {
      cache.destroy();
      cache.destroy();

      expect(cache.size).toBe(0);
    });
  });

  describe("size", () => {
    it("should return current entry count", () => {
      expect(cache.size).toBe(0);

      cache.set("key1", "value1");
      expect(cache.size).toBe(1);

      cache.set("key2", "value2");
      expect(cache.size).toBe(2);

      cache.delete("key1");
      expect(cache.size).toBe(1);
    });
  });
});
