import { RateLimiter } from "../src/providers/rate-limiting/rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should create limiter with default options", () => {
      limiter = new RateLimiter();

      expect(limiter).toBeDefined();
      expect(limiter.getAvailableTokens()).toBe(5); // default burstSize
    });

    it("should create limiter with custom options", () => {
      limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 20 });

      expect(limiter.getAvailableTokens()).toBe(20);
    });

    it("should start with full bucket", () => {
      limiter = new RateLimiter({ burstSize: 3 });

      expect(limiter.getAvailableTokens()).toBe(3);
    });
  });

  describe("tryAcquire", () => {
    beforeEach(() => {
      limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 3 });
    });

    it("should return true when tokens are available", () => {
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(2);
    });

    it("should consume tokens on each call", () => {
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(0);
    });

    it("should return false when no tokens available", () => {
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.tryAcquire();

      expect(limiter.tryAcquire()).toBe(false);
    });

    it("should refill tokens over time", () => {
      // Consume all tokens
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBe(0);

      // Advance time by 500ms (should add 1 token at 2 req/s)
      jest.advanceTimersByTime(500);

      expect(limiter.tryAcquire()).toBe(true);
    });

    it("should not exceed burst size when refilling", () => {
      // Advance time significantly
      jest.advanceTimersByTime(10000);

      // Should still be at burstSize (3)
      expect(limiter.getAvailableTokens()).toBe(3);
    });
  });

  describe("acquire", () => {
    beforeEach(() => {
      limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 });
    });

    it("should resolve immediately when tokens available", async () => {
      const promise = limiter.acquire();

      // Should resolve without advancing time
      await expect(promise).resolves.toBeUndefined();
      expect(limiter.getAvailableTokens()).toBe(1);
    });

    it("should wait when no tokens available", async () => {
      // Consume all tokens
      await limiter.acquire();
      await limiter.acquire();
      expect(limiter.getAvailableTokens()).toBe(0);

      // Start acquire that should wait
      let resolved = false;
      const promise = limiter.acquire().then(() => {
        resolved = true;
      });

      // Should not be resolved yet
      expect(resolved).toBe(false);

      // Advance time to allow token refill
      jest.advanceTimersByTime(500);
      await promise;

      expect(resolved).toBe(true);
    });

    it("should allow multiple waiters", async () => {
      // Consume all tokens
      await limiter.acquire();
      await limiter.acquire();

      // Start multiple acquires
      const results: number[] = [];
      const promise1 = limiter.acquire().then(() => results.push(1));
      const promise2 = limiter.acquire().then(() => results.push(2));

      // Advance time for first token
      jest.advanceTimersByTime(500);
      await promise1;

      // Advance time for second token
      jest.advanceTimersByTime(500);
      await promise2;

      expect(results).toEqual([1, 2]);
    });
  });

  describe("getWaitTimeMs", () => {
    beforeEach(() => {
      limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 });
    });

    it("should return 0 when tokens available", () => {
      expect(limiter.getWaitTimeMs()).toBe(0);
    });

    it("should return wait time when no tokens", () => {
      limiter.tryAcquire();
      limiter.tryAcquire();

      // At 2 req/s, need 500ms for 1 token
      expect(limiter.getWaitTimeMs()).toBe(500);
    });

    it("should return partial wait time after some time elapsed", () => {
      limiter.tryAcquire();
      limiter.tryAcquire();

      // Advance 250ms (half a token)
      jest.advanceTimersByTime(250);

      // Should need ~250ms more for full token
      expect(limiter.getWaitTimeMs()).toBe(250);
    });
  });

  describe("reset", () => {
    it("should restore tokens to burst size", () => {
      limiter = new RateLimiter({ burstSize: 5 });

      // Consume some tokens
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBe(2);

      limiter.reset();

      expect(limiter.getAvailableTokens()).toBe(5);
    });
  });

  describe("edge cases", () => {
    it("should handle very high request rate", () => {
      limiter = new RateLimiter({ requestsPerSecond: 1000, burstSize: 100 });

      // Should be able to burst 100 requests
      for (let i = 0; i < 100; i++) {
        expect(limiter.tryAcquire()).toBe(true);
      }
      expect(limiter.tryAcquire()).toBe(false);

      // After 1ms, should have 1 token (1000 req/s = 1 req/ms)
      jest.advanceTimersByTime(1);
      expect(limiter.tryAcquire()).toBe(true);
    });

    it("should handle very low request rate", () => {
      limiter = new RateLimiter({ requestsPerSecond: 0.1, burstSize: 1 });

      limiter.tryAcquire();
      expect(limiter.tryAcquire()).toBe(false);

      // At 0.1 req/s, need 10 seconds for 1 token
      jest.advanceTimersByTime(10000);
      expect(limiter.tryAcquire()).toBe(true);
    });

    it("should handle fractional tokens correctly", () => {
      limiter = new RateLimiter({ requestsPerSecond: 3, burstSize: 2 });

      limiter.tryAcquire();
      limiter.tryAcquire();

      // At 3 req/s, need ~333ms for 1 token
      jest.advanceTimersByTime(333);

      // Should have just under 1 token
      expect(limiter.tryAcquire()).toBe(false);

      // One more ms should give us the token
      jest.advanceTimersByTime(1);
      expect(limiter.tryAcquire()).toBe(true);
    });
  });

  describe("concurrent usage", () => {
    it("should handle rapid consecutive acquires", async () => {
      limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 });

      // Rapid fire 5 acquires (should all succeed immediately)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(limiter.acquire());
      }

      await Promise.all(promises);
      expect(limiter.getAvailableTokens()).toBe(0);
    });
  });
});
