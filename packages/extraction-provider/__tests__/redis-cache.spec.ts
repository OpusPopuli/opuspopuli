/**
 * Redis Cache Unit Tests
 *
 * Tests the RedisCache implementation with mocked Redis.
 * For real Redis tests, see integration tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { RedisCache } from "../src/cache/redis-cache";

// Mock ioredis
const mockRedisInstance = {
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  get: jest.fn(),
  setex: jest.fn().mockResolvedValue("OK"),
  exists: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  status: "wait",
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

describe("RedisCache (Unit)", () => {
  let cache: RedisCache<{ data: string }>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisInstance.status = "wait";
    cache = new RedisCache<{ data: string }>({
      url: "redis://localhost:6379",
      keyPrefix: "test:",
      ttlMs: 60000,
    });

    // Simulate connection event
    const connectHandler = mockRedisInstance.on.mock.calls.find(
      ([event]: [string]) => event === "connect",
    );
    if (connectHandler) {
      connectHandler[1]();
    }
  });

  afterEach(async () => {
    await cache.destroy();
  });

  describe("constructor", () => {
    it("should create with URL", () => {
      expect(cache).toBeDefined();
    });

    it("should create with host/port", () => {
      const hostCache = new RedisCache({
        host: "localhost",
        port: 6379,
      });
      expect(hostCache).toBeDefined();
    });

    it("should use default values", () => {
      const defaultCache = new RedisCache();
      expect(defaultCache).toBeDefined();
    });
  });

  describe("get", () => {
    it("should return parsed value when key exists", async () => {
      mockRedisInstance.get.mockResolvedValueOnce(
        JSON.stringify({ data: "value" }),
      );

      const result = await cache.get("key");
      expect(result).toEqual({ data: "value" });
      expect(mockRedisInstance.get).toHaveBeenCalledWith("test:key");
    });

    it("should return undefined when key does not exist", async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);

      const result = await cache.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should return undefined on error", async () => {
      mockRedisInstance.get.mockRejectedValueOnce(new Error("Redis error"));

      const result = await cache.get("key");
      expect(result).toBeUndefined();
    });
  });

  describe("set", () => {
    it("should store JSON-serialized value with TTL", async () => {
      await cache.set("key", { data: "value" });

      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        "test:key",
        60, // TTL in seconds
        JSON.stringify({ data: "value" }),
      );
    });

    it("should use custom TTL when provided", async () => {
      await cache.set("key", { data: "value" }, 30000); // 30 seconds

      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        "test:key",
        30,
        expect.any(String),
      );
    });

    it("should silently fail on error", async () => {
      mockRedisInstance.setex.mockRejectedValueOnce(new Error("Redis error"));

      // Should not throw
      await expect(
        cache.set("key", { data: "value" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("has", () => {
    it("should return true when key exists", async () => {
      mockRedisInstance.exists.mockResolvedValueOnce(1);

      const result = await cache.has("key");
      expect(result).toBe(true);
    });

    it("should return false when key does not exist", async () => {
      mockRedisInstance.exists.mockResolvedValueOnce(0);

      const result = await cache.has("key");
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockRedisInstance.exists.mockRejectedValueOnce(new Error("Redis error"));

      const result = await cache.has("key");
      expect(result).toBe(false);
    });
  });

  describe("delete", () => {
    it("should return true when key is deleted", async () => {
      mockRedisInstance.del.mockResolvedValueOnce(1);

      const result = await cache.delete("key");
      expect(result).toBe(true);
    });

    it("should return false when key does not exist", async () => {
      mockRedisInstance.del.mockResolvedValueOnce(0);

      const result = await cache.delete("key");
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockRedisInstance.del.mockRejectedValueOnce(new Error("Redis error"));

      const result = await cache.delete("key");
      expect(result).toBe(false);
    });
  });

  describe("clear", () => {
    it("should delete all keys with prefix", async () => {
      mockRedisInstance.keys.mockResolvedValueOnce([
        "test:key1",
        "test:key2",
        "test:key3",
      ]);
      mockRedisInstance.del.mockResolvedValueOnce(3);

      await cache.clear();

      expect(mockRedisInstance.keys).toHaveBeenCalledWith("test:*");
      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        "test:key1",
        "test:key2",
        "test:key3",
      );
    });

    it("should handle empty key list", async () => {
      mockRedisInstance.keys.mockResolvedValueOnce([]);

      await cache.clear();

      expect(mockRedisInstance.del).not.toHaveBeenCalled();
    });

    it("should silently fail on error", async () => {
      mockRedisInstance.keys.mockRejectedValueOnce(new Error("Redis error"));

      await expect(cache.clear()).resolves.toBeUndefined();
    });
  });

  describe("size", () => {
    it("should return count of keys with prefix", async () => {
      mockRedisInstance.keys.mockResolvedValueOnce([
        "test:a",
        "test:b",
        "test:c",
      ]);

      const size = await cache.size;
      expect(size).toBe(3);
    });

    it("should return 0 on error", async () => {
      mockRedisInstance.keys.mockRejectedValueOnce(new Error("Redis error"));

      const size = await cache.size;
      expect(size).toBe(0);
    });
  });

  describe("keys", () => {
    it("should return keys without prefix", async () => {
      mockRedisInstance.keys.mockResolvedValueOnce(["test:key1", "test:key2"]);

      const keys = await cache.keys();
      expect(keys).toEqual(["key1", "key2"]);
    });

    it("should return empty array on error", async () => {
      mockRedisInstance.keys.mockRejectedValueOnce(new Error("Redis error"));

      const keys = await cache.keys();
      expect(keys).toEqual([]);
    });
  });

  describe("destroy", () => {
    it("should quit Redis connection", async () => {
      await cache.destroy();
      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it("should disconnect on quit error", async () => {
      mockRedisInstance.quit.mockRejectedValueOnce(new Error("Quit error"));

      await cache.destroy();
      expect(mockRedisInstance.disconnect).toHaveBeenCalled();
    });
  });

  describe("isReady", () => {
    it("should return true when connected and ready", () => {
      mockRedisInstance.status = "ready";
      expect(cache.isReady()).toBe(true);
    });

    it("should return false when not connected", () => {
      mockRedisInstance.status = "wait";
      // Reset connection state
      const closeHandler = mockRedisInstance.on.mock.calls.find(
        ([event]: [string]) => event === "close",
      );
      if (closeHandler) {
        closeHandler[1]();
      }
      expect(cache.isReady()).toBe(false);
    });
  });

  describe("ping", () => {
    it("should return true on successful ping", async () => {
      (mockRedisInstance as any).ping = jest.fn().mockResolvedValueOnce("PONG");

      const result = await cache.ping();
      expect(result).toBe(true);
    });

    it("should return false on ping error", async () => {
      (mockRedisInstance as any).ping = jest
        .fn()
        .mockRejectedValueOnce(new Error("Ping error"));

      const result = await cache.ping();
      expect(result).toBe(false);
    });
  });
});
