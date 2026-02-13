/**
 * Utils module exports
 *
 * Core utilities (RateLimiter, withRetry, RetryPredicates) are now provided
 * by @opuspopuli/common. Re-exported here for backwards compatibility.
 */

// Re-export from common
export {
  RateLimiter,
  RateLimitOptions,
  IRateLimiter,
  RateLimitExceededError,
} from "@opuspopuli/common";
export {
  withRetry,
  calculateDelay,
  RetryPredicates,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
  RetryExhaustedError,
} from "@opuspopuli/common";
export type { WithRetryOptions } from "@opuspopuli/common";

// Local implementations (Redis-specific, stays in extraction-provider)
export * from "./redis-rate-limiter.js";
