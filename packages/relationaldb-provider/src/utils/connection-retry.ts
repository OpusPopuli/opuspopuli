import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { randomInt } from "node:crypto";
import {
  ConnectionRetryConfig,
  ConnectionRetryExhaustedError,
  DEFAULT_CONNECTION_RETRY_CONFIG,
} from "../types.js";

/**
 * Calculate delay using exponential backoff with optional jitter
 *
 * @param attempt - Current attempt number (1-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: ConnectionRetryConfig,
): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  if (!config.useJitter) {
    return cappedDelay;
  }

  // Add 0-25% random jitter to prevent thundering herd
  const maxJitter = Math.floor(0.25 * cappedDelay);
  const jitter = maxJitter > 0 ? randomInt(0, maxJitter + 1) : 0;

  return cappedDelay + jitter;
}

/**
 * Retryable error patterns - network/connection errors that are typically transient
 */
const RETRYABLE_PATTERNS = [
  "econnrefused", // Connection refused
  "econnreset", // Connection reset
  "etimedout", // Timed out
  "enotfound", // DNS not found
  "ehostunreach", // Host unreachable
  "enetunreach", // Network unreachable
  "connection refused",
  "connection terminated",
  "connection reset",
  "socket hang up",
  "too many connections",
  "server closed the connection",
  "the database system is starting up",
  "the database system is shutting down",
];

/**
 * Check if an error is a retryable connection error (transient)
 *
 * @param error - The error to check
 * @returns true if the error is retryable
 */
export function isRetryableConnectionError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Options for connectWithRetry function
 */
export interface ConnectionRetryOptions {
  /**
   * Retry configuration (uses defaults if not provided)
   */
  config?: Partial<ConnectionRetryConfig>;

  /**
   * Logger instance for logging retry attempts
   */
  logger?: Logger;

  /**
   * Callback invoked before each retry attempt
   */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract host from DataSource options for logging (avoids logging credentials)
 */
function extractHostForLogging(dataSource: DataSource): string {
  if (dataSource.options.type !== "postgres") {
    return "unknown";
  }
  return (dataSource.options as { host?: string }).host ?? "unknown";
}

/**
 * Normalize error to Error instance
 */
function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Determine if retry should continue after a failed attempt
 */
function shouldRetry(
  attempt: number,
  maxAttempts: number,
  error: Error,
  logger: Logger,
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }

  if (!isRetryableConnectionError(error)) {
    logger.error(`Non-retryable database error encountered: ${error.message}`);
    return false;
  }

  return true;
}

/**
 * Execute a single connection attempt
 */
async function executeConnectionAttempt(
  dataSource: DataSource,
  attempt: number,
  config: ConnectionRetryConfig,
  logger: Logger,
  startTime: number,
): Promise<DataSource | null> {
  const host = extractHostForLogging(dataSource);

  logger.log(
    `Database connection attempt ${attempt}/${config.maxAttempts} to ${host}`,
  );

  await dataSource.initialize();

  const connectionTime = Date.now() - startTime;
  logger.log(
    `Database connection established successfully after ${attempt} attempt(s) in ${connectionTime}ms`,
  );

  return dataSource;
}

/**
 * Handle failed connection attempt and prepare for retry
 */
async function handleFailedAttempt(
  error: Error,
  attempt: number,
  attemptDuration: number,
  config: ConnectionRetryConfig,
  logger: Logger,
  options: ConnectionRetryOptions,
): Promise<void> {
  logger.warn(
    `Database connection attempt ${attempt}/${config.maxAttempts} failed after ${attemptDuration}ms: ${error.message}`,
  );

  const delayMs = calculateBackoffDelay(attempt, config);

  if (options.onRetry) {
    options.onRetry(error, attempt, delayMs);
  }

  logger.log(
    `Retrying database connection in ${delayMs}ms (attempt ${attempt + 1}/${config.maxAttempts})`,
  );

  await sleep(delayMs);
}

/**
 * Attempt to establish a database connection with retry logic
 *
 * @param dataSource - TypeORM DataSource to initialize
 * @param options - Retry options
 * @returns Initialized DataSource
 * @throws ConnectionRetryExhaustedError if all attempts fail
 */
export async function connectWithRetry(
  dataSource: DataSource,
  options: ConnectionRetryOptions = {},
): Promise<DataSource> {
  const config: ConnectionRetryConfig = {
    ...DEFAULT_CONNECTION_RETRY_CONFIG,
    ...options.config,
  };
  const logger = options.logger ?? new Logger("ConnectionRetry");
  const startTime = Date.now();

  let lastError: Error = new Error("No connection attempts made");

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const attemptStartTime = Date.now();

    try {
      const result = await executeConnectionAttempt(
        dataSource,
        attempt,
        config,
        logger,
        startTime,
      );
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = normalizeError(error);
      const attemptDuration = Date.now() - attemptStartTime;

      if (!shouldRetry(attempt, config.maxAttempts, lastError, logger)) {
        break;
      }

      await handleFailedAttempt(
        lastError,
        attempt,
        attemptDuration,
        config,
        logger,
        options,
      );
    }
  }

  const totalDuration = Date.now() - startTime;
  const exhaustedError = new ConnectionRetryExhaustedError(
    config.maxAttempts,
    lastError,
    totalDuration,
  );

  logger.error(
    `Database connection failed after ${config.maxAttempts} attempts in ${totalDuration}ms: ${lastError.message}`,
  );

  throw exhaustedError;
}
