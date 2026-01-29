/**
 * Redis Rate Limiter Integration Tests
 *
 * Tests the RedisRateLimiter implementation against a real Redis instance.
 */
import { RedisRateLimiter } from "../../src/utils/redis-rate-limiter";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

describe("RedisRateLimiter (Integration)", () => {
  let limiter: RedisRateLimiter;

  beforeEach(async () => {
    limiter = new RedisRateLimiter({
      url: REDIS_URL,
      requestsPerSecond: 5,
      burstSize: 5,
      key: `test:ratelimit:${Date.now()}`, // Unique key per test
    });
    await limiter.reset();
  });

  afterEach(async () => {
    await limiter.reset();
    await limiter.destroy();
  });

  describe("connection", () => {
    it("should connect to Redis", async () => {
      // Force connection via acquire
      await limiter.acquire();
      expect(limiter.isReady()).toBe(true);
    });
  });

  describe("token bucket algorithm", () => {
    it("should allow requests within burst limit", async () => {
      // 5 requests should all succeed immediately (burst = 5)
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        results.push(await limiter.tryAcquire());
      }

      expect(results.every((r) => r === true)).toBe(true);
    });

    it("should return available tokens", async () => {
      const initial = await limiter.getAvailableTokens();
      expect(initial).toBeCloseTo(5, 0); // Should start with burst size

      await limiter.tryAcquire();
      await limiter.tryAcquire();

      const afterTwo = await limiter.getAvailableTokens();
      expect(afterTwo).toBeLessThan(initial);
    });

    it("should reject requests when tokens exhausted", async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.tryAcquire();
      }

      // Next request should fail (no waiting)
      const result = await limiter.tryAcquire();
      expect(result).toBe(false);
    });

    it("should refill tokens over time", async () => {
      // Exhaust tokens
      for (let i = 0; i < 5; i++) {
        await limiter.tryAcquire();
      }

      // Wait for some tokens to refill (5 req/sec = 1 token per 200ms)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have some tokens now
      const tokens = await limiter.getAvailableTokens();
      expect(tokens).toBeGreaterThan(0);
    }, 10000);
  });

  describe("acquire (blocking)", () => {
    it("should wait when tokens exhausted", async () => {
      const fastLimiter = new RedisRateLimiter({
        url: REDIS_URL,
        requestsPerSecond: 10, // Fast refill
        burstSize: 2,
        key: `test:ratelimit:blocking:${Date.now()}`,
      });

      // Exhaust burst
      await fastLimiter.tryAcquire();
      await fastLimiter.tryAcquire();

      const startTime = Date.now();
      await fastLimiter.acquire(); // Should block until token available
      const elapsed = Date.now() - startTime;

      // Should have waited some time (at least 50ms for 10 req/sec)
      expect(elapsed).toBeGreaterThan(50);

      await fastLimiter.destroy();
    }, 10000);
  });

  describe("getWaitTimeMs", () => {
    it("should return 0 when tokens available", async () => {
      const waitTime = await limiter.getWaitTimeMs();
      expect(waitTime).toBe(0);
    });

    it("should return positive wait time when tokens exhausted", async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.tryAcquire();
      }

      const waitTime = await limiter.getWaitTimeMs();
      expect(waitTime).toBeGreaterThan(0);
    });
  });

  describe("reset", () => {
    it("should reset limiter to initial state", async () => {
      // Exhaust tokens
      for (let i = 0; i < 5; i++) {
        await limiter.tryAcquire();
      }

      expect(await limiter.tryAcquire()).toBe(false);

      // Reset
      await limiter.reset();

      // Should have tokens again
      const result = await limiter.tryAcquire();
      expect(result).toBe(true);
    });
  });

  describe("distributed rate limiting", () => {
    it("should share state across multiple limiter instances", async () => {
      const sharedKey = `test:ratelimit:shared:${Date.now()}`;

      const limiter1 = new RedisRateLimiter({
        url: REDIS_URL,
        requestsPerSecond: 5,
        burstSize: 3,
        key: sharedKey,
      });

      const limiter2 = new RedisRateLimiter({
        url: REDIS_URL,
        requestsPerSecond: 5,
        burstSize: 3,
        key: sharedKey,
      });

      // Use 2 tokens from limiter1
      await limiter1.tryAcquire();
      await limiter1.tryAcquire();

      // Use 1 token from limiter2
      const result = await limiter2.tryAcquire();
      expect(result).toBe(true);

      // Next request from either should fail (3 total used)
      expect(await limiter1.tryAcquire()).toBe(false);
      expect(await limiter2.tryAcquire()).toBe(false);

      await limiter1.destroy();
      await limiter2.destroy();
    });
  });
});
