/**
 * Extraction Provider Types
 *
 * Types and interfaces for the extraction provider infrastructure layer.
 * Shared types (CacheOptions, RateLimitOptions, RetryConfig, etc.) are
 * re-exported from @opuspopuli/common for backwards compatibility.
 */

// Re-export shared types from common for backwards compatibility
export type { CacheOptions, ICache } from "@opuspopuli/common";
export type { RateLimitOptions, IRateLimiter } from "@opuspopuli/common";
export type { RetryConfig } from "@opuspopuli/common";
export { RateLimitExceededError } from "@opuspopuli/common";
export { RetryExhaustedError } from "@opuspopuli/common";

// Local import for use in this file's interfaces
import type {
  CacheOptions,
  RateLimitOptions,
  RetryConfig,
} from "@opuspopuli/common";

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
 * Injection token for ExtractionConfig
 */
export const EXTRACTION_CONFIG = "EXTRACTION_CONFIG";
