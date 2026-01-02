/**
 * Rate Limiter using Token Bucket Algorithm
 *
 * Controls the rate of requests to prevent overwhelming external services.
 * Tokens are added at a steady rate, and each request consumes one token.
 */

import { RateLimitOptions } from "../types.js";

/**
 * Token bucket rate limiter
 *
 * @example
 * const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 5 });
 * await limiter.acquire(); // Waits if necessary
 * // Make request...
 */
export class RateLimiter {
  private readonly requestsPerSecond: number;
  private readonly burstSize: number;
  private tokens: number;
  private lastRefillTime: number;

  constructor(options: RateLimitOptions = {}) {
    this.requestsPerSecond = options.requestsPerSecond ?? 2;
    this.burstSize = options.burstSize ?? 5;
    this.tokens = this.burstSize; // Start with full bucket
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquire a token, waiting if necessary
   * Returns a promise that resolves when a token is available
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time for next token
    const waitTimeMs = this.getWaitTimeMs();
    await this.sleep(waitTimeMs);

    // Refill and consume after waiting
    this.refill();
    this.tokens -= 1;
  }

  /**
   * Try to acquire a token without waiting
   * Returns true if token was acquired, false otherwise
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get the time in milliseconds until the next token is available
   * Returns 0 if a token is immediately available
   */
  getWaitTimeMs(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    // Time for one token = 1000ms / requestsPerSecond
    const msPerToken = 1000 / this.requestsPerSecond;
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil(tokensNeeded * msPerToken);
  }

  /**
   * Get the current number of available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Reset the limiter to its initial state (full bucket)
   */
  reset(): void {
    this.tokens = this.burstSize;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;

    if (elapsedMs <= 0) {
      return;
    }

    // Calculate tokens to add based on elapsed time
    const tokensToAdd = (elapsedMs / 1000) * this.requestsPerSecond;
    this.tokens = Math.min(this.burstSize, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Sleep for the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
