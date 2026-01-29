/**
 * Extraction Provider Types
 *
 * Types and interfaces for the extraction provider infrastructure layer.
 * Includes configuration for caching, rate limiting, and retry logic.
 */

/**
 * Options for HTTP fetch requests
 */
export interface FetchOptions {
  /** Custom headers to include in the request */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Skip cache and fetch fresh content */
  bypassCache?: boolean;
}

/**
 * Options for fetch requests with retry logic
 */
export interface RetryOptions extends FetchOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs?: number;
}

/**
 * Configuration options for the in-memory cache
 */
export interface CacheOptions {
  /** Time-to-live in milliseconds for cache entries (default: 300000 = 5 min) */
  ttlMs?: number;
  /** Maximum number of entries in the cache (default: 100) */
  maxSize?: number;
}

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
 * Custom fetch function type for HTTP connection pooling support
 */
export type FetchFunction = (
  url: string | URL,
  options?: RequestInit,
) => Promise<Response>;

/**
 * Complete configuration for the ExtractionProvider
 */
export interface ExtractionConfig {
  /** Cache configuration */
  cache: CacheOptions;
  /** Rate limiting configuration */
  rateLimit: RateLimitOptions;
  /** Default timeout for requests in milliseconds */
  defaultTimeout: number;
  /** Retry configuration */
  retry: RetryConfig;
  /**
   * Custom fetch function for HTTP connection pooling
   * If not provided, uses native fetch (which respects global dispatcher)
   */
  fetchFn?: FetchFunction;
  /**
   * Cache provider to use (memory or redis)
   * Defaults to redis if REDIS_URL env var is set, otherwise memory
   */
  cacheProvider?: "memory" | "redis";
  /**
   * Redis URL for distributed caching
   * Can also be set via REDIS_URL environment variable
   */
  redisUrl?: string;
}

/**
 * Default configuration values
 */
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  cache: {
    ttlMs: 300000, // 5 minutes
    maxSize: 100,
  },
  rateLimit: {
    requestsPerSecond: 2,
    burstSize: 5,
  },
  defaultTimeout: 30000, // 30 seconds
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
};

/**
 * Result from a cached fetch operation
 */
export interface CachedFetchResult {
  /** The fetched content */
  content: string;
  /** Whether the result was served from cache */
  fromCache: boolean;
  /** HTTP status code (if not from cache) */
  statusCode?: number;
  /** Content-Type header value */
  contentType?: string;
}

/**
 * Error thrown when a fetch operation fails
 */
export class FetchError extends Error {
  constructor(
    public readonly url: string,
    public readonly statusCode: number | undefined,
    message: string,
    public readonly cause?: Error,
  ) {
    super(`Failed to fetch ${url}: ${message}`);
    this.name = "FetchError";
  }
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

/**
 * Injection token for ExtractionConfig
 */
export const EXTRACTION_CONFIG = "EXTRACTION_CONFIG";
