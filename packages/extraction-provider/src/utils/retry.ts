/**
 * Retry Utility with Exponential Backoff
 *
 * Provides retry logic with exponential backoff and jitter
 * for handling transient failures in external service calls.
 */

import { randomInt } from "node:crypto";

import { RetryConfig, RetryExhaustedError } from "../types.js";

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Options for the withRetry function
 */
export interface WithRetryOptions extends Partial<RetryConfig> {
  /**
   * Function to determine if an error is retryable
   * By default, all errors are retryable
   */
  isRetryable?: (error: Error) => boolean;

  /**
   * Callback invoked before each retry attempt
   */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Wraps an async function with retry logic using exponential backoff
 *
 * @param fn - The async function to wrap
 * @param options - Retry configuration options
 * @returns The result of the function if successful
 * @throws RetryExhaustedError if all retry attempts fail
 *
 * @example
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxAttempts: 3, baseDelayMs: 1000 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const config: RetryConfig = {
    maxAttempts: options.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
  };

  const isRetryable = options.isRetryable ?? (() => true);
  const onRetry = options.onRetry;

  let lastError: Error = new Error("No attempts made");

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is the last attempt
      if (attempt >= config.maxAttempts) {
        break;
      }

      // Check if error is retryable
      if (!isRetryable(lastError)) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const delayMs = calculateDelay(attempt, config);

      // Notify of retry
      if (onRetry) {
        onRetry(lastError, attempt, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  throw new RetryExhaustedError(config.maxAttempts, lastError);
}

/**
 * Calculate delay using exponential backoff with jitter
 *
 * Formula: min(maxDelay, baseDelay * 2^(attempt-1)) + random jitter
 * Jitter adds 0-25% randomness to prevent thundering herd
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter (0-25% of the delay) using crypto for security compliance
  const maxJitter = Math.floor(0.25 * cappedDelay);
  const jitter = maxJitter > 0 ? randomInt(0, maxJitter + 1) : 0;

  return cappedDelay + jitter;
}

/**
 * Sleep for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Common retry predicates for different error types
 */
export const RetryPredicates = {
  /**
   * Retry on network errors (fetch failures, timeouts)
   */
  isNetworkError: (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("fetch failed")
    );
  },

  /**
   * Retry on HTTP 5xx errors
   */
  isServerError: (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504") ||
      message.includes("internal server error") ||
      message.includes("bad gateway") ||
      message.includes("service unavailable") ||
      message.includes("gateway timeout")
    );
  },

  /**
   * Retry on rate limit errors (HTTP 429)
   */
  isRateLimitError: (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("too many requests")
    );
  },

  /**
   * Combine multiple predicates - retry if ANY predicate returns true
   */
  any:
    (...predicates: ((error: Error) => boolean)[]) =>
    (error: Error): boolean =>
      predicates.some((predicate) => predicate(error)),

  /**
   * Combine multiple predicates - retry if ALL predicates return true
   */
  all:
    (...predicates: ((error: Error) => boolean)[]) =>
    (error: Error): boolean =>
      predicates.every((predicate) => predicate(error)),
};
