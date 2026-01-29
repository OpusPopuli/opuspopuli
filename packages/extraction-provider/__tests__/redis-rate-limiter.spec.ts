/**
 * Redis Rate Limiter Unit Tests
 *
 * Tests the RedisRateLimiter implementation with mocked Redis.
 * For real Redis tests, see integration tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { RedisRateLimiter } from "../src/utils/redis-rate-limiter";

// Mock ioredis
const mockRedisInstance = {
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  defineCommand: jest.fn(),
  tokenBucket: jest.fn(),
  hmget: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  status: "wait",
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

describe("RedisRateLimiter (Unit)", () => {
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisInstance.status = "wait";
    limiter = new RedisRateLimiter({
      url: "redis://localhost:6379",
      requestsPerSecond: 5,
      burstSize: 5,
      key: "test:ratelimit",
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
    await limiter.destroy();
  });

  describe("constructor", () => {
    it("should create with URL", () => {
      expect(limiter).toBeDefined();
      expect(mockRedisInstance.defineCommand).toHaveBeenCalledWith(
        "tokenBucket",
        expect.objectContaining({
          numberOfKeys: 1,
        }),
      );
    });

    it("should create with host/port", () => {
      const hostLimiter = new RedisRateLimiter({
        host: "localhost",
        port: 6379,
      });
      expect(hostLimiter).toBeDefined();
    });

    it("should use default values", () => {
      const defaultLimiter = new RedisRateLimiter();
      expect(defaultLimiter).toBeDefined();
    });
  });

  describe("acquire", () => {
    it("should acquire token immediately when available", async () => {
      mockRedisInstance.tokenBucket.mockResolvedValueOnce([4, 0]); // 4 tokens left, 0 wait

      await limiter.acquire();

      expect(mockRedisInstance.tokenBucket).toHaveBeenCalled();
    });

    it("should wait and retry when tokens exhausted", async () => {
      mockRedisInstance.tokenBucket
        .mockResolvedValueOnce([0, 100]) // No tokens, wait 100ms
        .mockResolvedValueOnce([4, 0]); // Tokens available after wait

      const startTime = Date.now();
      await limiter.acquire();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(mockRedisInstance.tokenBucket).toHaveBeenCalledTimes(2);
    }, 10000);

    it("should allow request on Redis error (fail open)", async () => {
      mockRedisInstance.tokenBucket.mockRejectedValueOnce(
        new Error("Redis error"),
      );

      // Should not throw
      await expect(limiter.acquire()).resolves.toBeUndefined();
    });
  });

  describe("tryAcquire", () => {
    it("should return true when token acquired", async () => {
      mockRedisInstance.tokenBucket.mockResolvedValueOnce([4, 0]);

      const result = await limiter.tryAcquire();
      expect(result).toBe(true);
    });

    it("should return false when no tokens available", async () => {
      mockRedisInstance.tokenBucket.mockResolvedValueOnce([0, 100]);

      const result = await limiter.tryAcquire();
      expect(result).toBe(false);
    });

    it("should return true on Redis error (fail open)", async () => {
      mockRedisInstance.tokenBucket.mockRejectedValueOnce(
        new Error("Redis error"),
      );

      const result = await limiter.tryAcquire();
      expect(result).toBe(true);
    });
  });

  describe("getWaitTimeMs", () => {
    it("should return 0 when tokens available", async () => {
      mockRedisInstance.tokenBucket.mockResolvedValueOnce([5, 0]);

      const waitTime = await limiter.getWaitTimeMs();
      expect(waitTime).toBe(0);
    });

    it("should calculate wait time when tokens depleted", async () => {
      mockRedisInstance.tokenBucket.mockResolvedValueOnce([0.5, 0]); // 0.5 tokens

      const waitTime = await limiter.getWaitTimeMs();
      // Need 0.5 tokens at 5 req/sec = 100ms
      expect(waitTime).toBe(100);
    });

    it("should return 0 on Redis error", async () => {
      mockRedisInstance.tokenBucket.mockRejectedValueOnce(
        new Error("Redis error"),
      );

      const waitTime = await limiter.getWaitTimeMs();
      expect(waitTime).toBe(0);
    });
  });

  describe("getAvailableTokens", () => {
    it("should return available tokens", async () => {
      const now = Date.now();
      mockRedisInstance.hmget.mockResolvedValueOnce(["3", String(now)]);

      const tokens = await limiter.getAvailableTokens();
      expect(tokens).toBeCloseTo(3, 0);
    });

    it("should return burst size when no data", async () => {
      mockRedisInstance.hmget.mockResolvedValueOnce([null, null]);

      const tokens = await limiter.getAvailableTokens();
      expect(tokens).toBeCloseTo(5, 0);
    });

    it("should return burst size on error", async () => {
      mockRedisInstance.hmget.mockRejectedValueOnce(new Error("Redis error"));

      const tokens = await limiter.getAvailableTokens();
      expect(tokens).toBe(5);
    });

    it("should cap tokens at burst size", async () => {
      const pastTime = Date.now() - 10000; // 10 seconds ago
      mockRedisInstance.hmget.mockResolvedValueOnce(["2", String(pastTime)]);

      const tokens = await limiter.getAvailableTokens();
      // 2 + (10 * 5) = 52, but capped at burst (5)
      expect(tokens).toBe(5);
    });
  });

  describe("reset", () => {
    it("should delete the limiter key", async () => {
      await limiter.reset();
      expect(mockRedisInstance.del).toHaveBeenCalledWith("test:ratelimit");
    });

    it("should silently fail on error", async () => {
      mockRedisInstance.del.mockRejectedValueOnce(new Error("Redis error"));

      await expect(limiter.reset()).resolves.toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("should quit Redis connection", async () => {
      await limiter.destroy();
      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it("should disconnect on quit error", async () => {
      mockRedisInstance.quit.mockRejectedValueOnce(new Error("Quit error"));

      await limiter.destroy();
      expect(mockRedisInstance.disconnect).toHaveBeenCalled();
    });
  });

  describe("isReady", () => {
    it("should return true when connected and ready", () => {
      mockRedisInstance.status = "ready";
      expect(limiter.isReady()).toBe(true);
    });

    it("should return false when not connected", () => {
      mockRedisInstance.status = "wait";
      const closeHandler = mockRedisInstance.on.mock.calls.find(
        ([event]: [string]) => event === "close",
      );
      if (closeHandler) {
        closeHandler[1]();
      }
      expect(limiter.isReady()).toBe(false);
    });
  });
});
