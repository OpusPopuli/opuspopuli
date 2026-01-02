import { registerAs } from '@nestjs/config';

/**
 * Extraction Configuration
 *
 * Controls rate limiting, caching, retry behavior, and timeouts
 * for the ExtractionProvider infrastructure.
 */
export default registerAs('extraction', () => ({
  // Rate limiting configuration
  rateLimit: {
    // Maximum requests per second
    requestsPerSecond: Number.parseInt(
      process.env.EXTRACTION_RATE_LIMIT_RPS || '2',
      10,
    ),
    // Burst size for token bucket algorithm
    burstSize: Number.parseInt(
      process.env.EXTRACTION_RATE_LIMIT_BURST || '5',
      10,
    ),
  },

  // Cache configuration
  cache: {
    // Time-to-live in milliseconds (default: 5 minutes)
    ttlMs: Number.parseInt(process.env.EXTRACTION_CACHE_TTL_MS || '300000', 10),
    // Maximum number of cached entries
    maxSize: Number.parseInt(
      process.env.EXTRACTION_CACHE_MAX_SIZE || '100',
      10,
    ),
  },

  // Default timeout for requests in milliseconds
  defaultTimeout: Number.parseInt(
    process.env.EXTRACTION_DEFAULT_TIMEOUT_MS || '30000',
    10,
  ),

  // Retry configuration
  retry: {
    // Maximum number of retry attempts
    maxAttempts: Number.parseInt(
      process.env.EXTRACTION_RETRY_MAX_ATTEMPTS || '3',
      10,
    ),
    // Base delay in milliseconds for exponential backoff
    baseDelayMs: Number.parseInt(
      process.env.EXTRACTION_RETRY_BASE_DELAY_MS || '1000',
      10,
    ),
    // Maximum delay in milliseconds between retries
    maxDelayMs: Number.parseInt(
      process.env.EXTRACTION_RETRY_MAX_DELAY_MS || '30000',
      10,
    ),
  },
}));
