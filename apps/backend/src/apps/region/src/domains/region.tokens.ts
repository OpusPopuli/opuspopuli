/**
 * Injection tokens for the Region module.
 *
 * Separated from region.module.ts to avoid circular imports
 * (region.service.ts ↔ region.module.ts).
 */
import { DEFAULT_EXTRACTION_CONFIG } from '@opuspopuli/extraction-provider';

export const REGION_CACHE = Symbol('REGION_CACHE');

/**
 * The per-host fetch rate limiter (S1). Its buckets and policies live in
 * Redis, so this instance and the one inside the scraping pipeline's DI
 * scope enforce one budget per government site.
 */
export const HOST_RATE_LIMITER = Symbol('HOST_RATE_LIMITER');

/**
 * The rate for a host no region config names — the same default
 * `ExtractionProvider` falls back to, so the two limiter instances agree on
 * an unconfigured host as they do on a configured one.
 */
export const DEFAULT_HOST_RATE = {
  requestsPerSecond: DEFAULT_EXTRACTION_CONFIG.rateLimit.requestsPerSecond ?? 2,
  burstSize: DEFAULT_EXTRACTION_CONFIG.rateLimit.burstSize ?? 5,
};
