/**
 * Database connection retry configuration
 */
export interface ConnectionRetryConfig {
  /**
   * Maximum number of connection retry attempts
   * Default: 5
   */
  maxAttempts: number;

  /**
   * Base delay in milliseconds for exponential backoff
   * Actual delay = baseDelayMs * 2^(attempt-1)
   * Default: 1000 (1 second)
   */
  baseDelayMs: number;

  /**
   * Maximum delay in milliseconds between retries
   * Caps the exponential growth
   * Default: 30000 (30 seconds)
   */
  maxDelayMs: number;

  /**
   * Whether to add random jitter to delay to prevent thundering herd
   * Adds 0-25% random delay on top of calculated delay
   * Default: true
   */
  useJitter: boolean;
}

/**
 * Default connection retry configuration
 */
export const DEFAULT_CONNECTION_RETRY_CONFIG: ConnectionRetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  useJitter: true,
};

/**
 * Error thrown when all connection retry attempts are exhausted
 */
export class ConnectionRetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: Error,
    public readonly totalDurationMs: number,
  ) {
    super(
      `Database connection failed after ${attempts} attempts (${totalDurationMs}ms): ${lastError.message}`,
    );
    this.name = "ConnectionRetryExhaustedError";
  }
}
