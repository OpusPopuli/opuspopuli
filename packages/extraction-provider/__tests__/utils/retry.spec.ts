import {
  withRetry,
  calculateDelay,
  RetryPredicates,
  DEFAULT_RETRY_CONFIG,
} from "../../src/utils/retry";
import { RetryExhaustedError } from "../../src/types";

describe("retry utility", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("withRetry", () => {
    it("should return result on first successful attempt", async () => {
      const fn = jest.fn().mockResolvedValue("success");

      const result = await withRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure and succeed", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 3 });

      // Advance timer for first retry delay
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should throw RetryExhaustedError after all attempts fail", async () => {
      const error = new Error("persistent failure");
      const fn = jest.fn().mockRejectedValue(error);

      let caughtError: RetryExhaustedError | null = null;
      const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100 }).catch(
        (e) => {
          caughtError = e;
        },
      );

      // Advance through all retries
      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(caughtError!.attempts).toBe(3);
      expect(caughtError!.lastError).toBe(error);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should use default config when no options provided", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("fail"));

      let caughtError: Error | null = null;
      const promise = withRetry(fn).catch((e) => {
        caughtError = e;
      });

      // Advance through default attempts
      await jest.advanceTimersByTimeAsync(100000);
      await promise;

      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRY_CONFIG.maxAttempts);
    });

    it("should respect isRetryable predicate", async () => {
      const retryableError = new Error("network error");
      const nonRetryableError = new Error("validation error");

      const fn = jest
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(nonRetryableError);

      const isRetryable = jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      let caughtError: Error | null = null;
      const promise = withRetry(fn, { maxAttempts: 5, isRetryable }).catch(
        (e) => {
          caughtError = e;
        },
      );

      await jest.advanceTimersByTimeAsync(5000);
      await promise;

      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(isRetryable).toHaveBeenCalledWith(retryableError);
      expect(isRetryable).toHaveBeenCalledWith(nonRetryableError);
    });

    it("should call onRetry callback before each retry", async () => {
      const error = new Error("fail");
      const fn = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const onRetry = jest.fn();

      const promise = withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        onRetry,
      });

      await jest.advanceTimersByTimeAsync(1000);

      await promise;

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(error, 1, expect.any(Number));
      expect(onRetry).toHaveBeenCalledWith(error, 2, expect.any(Number));
    });

    it("should handle non-Error throws", async () => {
      const fn = jest.fn().mockRejectedValue("string error");

      const promise = withRetry(fn, { maxAttempts: 1 });

      await expect(promise).rejects.toThrow(RetryExhaustedError);
    });

    it("should not retry when maxAttempts is 1", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("fail"));

      const promise = withRetry(fn, { maxAttempts: 1 });

      await expect(promise).rejects.toThrow(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("calculateDelay", () => {
    // Mock crypto.randomInt for deterministic tests
    let randomIntMock: jest.SpyInstance;

    beforeEach(() => {
      // Mock randomInt to return 0 (no jitter) by default
      randomIntMock = jest
        .spyOn(require("node:crypto"), "randomInt")
        .mockReturnValue(0);
    });

    afterEach(() => {
      randomIntMock.mockRestore();
    });

    it("should calculate exponential backoff", () => {
      const config = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30000 };

      // With jitter = 0 (randomInt returns 0)
      expect(calculateDelay(1, config)).toBe(1000); // 1000 * 2^0 = 1000
      expect(calculateDelay(2, config)).toBe(2000); // 1000 * 2^1 = 2000
      expect(calculateDelay(3, config)).toBe(4000); // 1000 * 2^2 = 4000
      expect(calculateDelay(4, config)).toBe(8000); // 1000 * 2^3 = 8000
    });

    it("should cap delay at maxDelayMs", () => {
      const config = { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 5000 };

      // 1000 * 2^5 = 32000, should be capped at 5000
      expect(calculateDelay(6, config)).toBe(5000);
      expect(calculateDelay(10, config)).toBe(5000);
    });

    it("should add jitter to delay", () => {
      const config = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000 };

      // Mock randomInt to return 125 (half of maxJitter which is 250)
      randomIntMock.mockReturnValue(125);

      const delay = calculateDelay(1, config);
      // Base delay 1000 + 125 jitter = 1125
      expect(delay).toBe(1125);
    });

    it("should handle very large attempt numbers", () => {
      const config = { maxAttempts: 100, baseDelayMs: 1000, maxDelayMs: 30000 };

      // Should be capped at maxDelayMs regardless of attempt
      expect(calculateDelay(50, config)).toBe(30000);
    });
  });

  describe("RetryPredicates", () => {
    describe("isNetworkError", () => {
      it("should return true for network errors", () => {
        expect(RetryPredicates.isNetworkError(new Error("Network error"))).toBe(
          true,
        );
        expect(RetryPredicates.isNetworkError(new Error("timeout"))).toBe(true);
        expect(RetryPredicates.isNetworkError(new Error("ECONNREFUSED"))).toBe(
          true,
        );
        expect(RetryPredicates.isNetworkError(new Error("ECONNRESET"))).toBe(
          true,
        );
        expect(RetryPredicates.isNetworkError(new Error("fetch failed"))).toBe(
          true,
        );
      });

      it("should return false for non-network errors", () => {
        expect(
          RetryPredicates.isNetworkError(new Error("validation error")),
        ).toBe(false);
        expect(RetryPredicates.isNetworkError(new Error("not found"))).toBe(
          false,
        );
      });
    });

    describe("isServerError", () => {
      it("should return true for 5xx errors", () => {
        expect(RetryPredicates.isServerError(new Error("HTTP 500"))).toBe(true);
        expect(
          RetryPredicates.isServerError(new Error("502 Bad Gateway")),
        ).toBe(true);
        expect(
          RetryPredicates.isServerError(new Error("503 Service Unavailable")),
        ).toBe(true);
        expect(
          RetryPredicates.isServerError(new Error("504 Gateway Timeout")),
        ).toBe(true);
        expect(
          RetryPredicates.isServerError(new Error("Internal Server Error")),
        ).toBe(true);
      });

      it("should return false for non-server errors", () => {
        expect(RetryPredicates.isServerError(new Error("404 Not Found"))).toBe(
          false,
        );
        expect(
          RetryPredicates.isServerError(new Error("400 Bad Request")),
        ).toBe(false);
      });
    });

    describe("isRateLimitError", () => {
      it("should return true for rate limit errors", () => {
        expect(
          RetryPredicates.isRateLimitError(new Error("429 Too Many Requests")),
        ).toBe(true);
        expect(
          RetryPredicates.isRateLimitError(new Error("Rate limit exceeded")),
        ).toBe(true);
        expect(
          RetryPredicates.isRateLimitError(new Error("too many requests")),
        ).toBe(true);
      });

      it("should return false for non-rate-limit errors", () => {
        expect(
          RetryPredicates.isRateLimitError(new Error("500 Server Error")),
        ).toBe(false);
      });
    });

    describe("any combinator", () => {
      it("should return true if any predicate matches", () => {
        const combined = RetryPredicates.any(
          RetryPredicates.isNetworkError,
          RetryPredicates.isServerError,
        );

        expect(combined(new Error("Network error"))).toBe(true);
        expect(combined(new Error("500 Server Error"))).toBe(true);
        expect(combined(new Error("404 Not Found"))).toBe(false);
      });
    });

    describe("all combinator", () => {
      it("should return true only if all predicates match", () => {
        // Contrived example - error must contain both keywords
        const isTimeout = (e: Error) =>
          e.message.toLowerCase().includes("timeout");
        const isGateway = (e: Error) =>
          e.message.toLowerCase().includes("gateway");

        const combined = RetryPredicates.all(isTimeout, isGateway);

        expect(combined(new Error("Gateway Timeout"))).toBe(true);
        expect(combined(new Error("Connection Timeout"))).toBe(false);
        expect(combined(new Error("Bad Gateway"))).toBe(false);
      });
    });
  });

  describe("DEFAULT_RETRY_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    });
  });
});
