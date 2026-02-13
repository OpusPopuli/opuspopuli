/**
 * Rate Limiting Types
 *
 * Types and interfaces for rate limiting implementations.
 */

/**
 * Configuration options for rate limiting
 */
export interface RateLimitOptions {
  /** Maximum requests per second (default: 2) */
  requestsPerSecond?: number;
  /** Burst size for token bucket algorithm (default: 5) */
  burstSize?: number;
}

/**
 * Rate limiter interface for distributed rate limiting
 */
export interface IRateLimiter {
  /**
   * Acquire a token, waiting if necessary
   * @returns Promise that resolves when a token is available
   */
  acquire(): Promise<void>;

  /**
   * Try to acquire a token without waiting
   * @returns True if token was acquired, false otherwise
   */
  tryAcquire(): Promise<boolean> | boolean;

  /**
   * Get the time in milliseconds until the next token is available
   * @returns 0 if a token is immediately available
   */
  getWaitTimeMs(): Promise<number> | number;

  /**
   * Get the current number of available tokens
   */
  getAvailableTokens(): Promise<number> | number;

  /**
   * Reset the limiter to its initial state
   */
  reset(): Promise<void> | void;
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitExceededError extends Error {
  constructor(public readonly waitTimeMs: number) {
    super(`Rate limit exceeded. Try again in ${waitTimeMs}ms`);
    this.name = "RateLimitExceededError";
  }
}
