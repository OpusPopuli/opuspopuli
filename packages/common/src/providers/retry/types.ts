/**
 * Retry Types
 *
 * Types and error classes for retry logic with exponential backoff.
 */

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
}

/**
 * Error thrown when all retry attempts are exhausted
 */
export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`All ${attempts} retry attempts exhausted: ${lastError.message}`);
    this.name = "RetryExhaustedError";
  }
}
