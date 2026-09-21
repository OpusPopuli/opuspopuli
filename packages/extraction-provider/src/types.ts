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
  /**
   * True when this URL came from a region's data source config (so a
   * redirect is actionable: update the config). False/unset when the URL
   * was harvested at runtime (e.g., detail links extracted from a listing
   * page) — redirects on those aren't fixable by editing config and are
   * logged at debug instead of warn.
   */
  fromConfig?: boolean;
  /**
   * Archive this fetch as a cited source (#1276).
   *
   * Opt-in per call rather than on by default: the store is sized for the
   * artifacts claims actually reference, and archiving every list page and
   * link-discovery crawl would fill it with pages nothing cites.
   *
   * Setting this also bypasses the read cache. Archiving needs the raw bytes,
   * and a cache hit has only the decoded text — so a cached read could not
   * capture the artifact, and would leave a cited source unarchived depending
   * on nothing more than whether something else happened to fetch it in the
   * last few minutes.
   */
  archive?: ArchiveContext;
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
 * Provenance captured at the moment a URL is fetched.
 *
 * Content-addresses the artifact so a cited source can be pinned to the exact
 * bytes a claim was drawn from (#1276). `contentHash` is taken over the raw
 * response body *before* decoding — hashing decoded text would attest to our
 * interpretation rather than to what the server sent, and would collapse
 * bodies that decode alike but differ on the wire.
 *
 * The HTTP validators are recorded rather than acted on: they let a later
 * re-fetch be conditional, and they evidence what the server claimed about
 * the artifact at fetch time.
 */
export interface FetchProvenance {
  /** SHA-256 of the raw response body, hex-encoded */
  contentHash: string;
  /**
   * When the body was received, ISO 8601.
   *
   * A string rather than a `Date` on purpose: fetch results are cached, and
   * the Redis cache round-trips them through `JSON.stringify`/`JSON.parse`
   * (`redis-cache.ts:87,104`). A `Date` would return from that cache as a
   * string still *typed* as `Date` — and the in-memory cache would preserve
   * the real `Date`, so the two backends would disagree about the type of the
   * same field. ISO 8601 round-trips identically through both, and Prisma
   * accepts it directly for a `DateTime` column.
   */
  fetchedAt: string;
  /** ETag response header, if the server sent one */
  etag?: string;
  /** Last-Modified response header, if the server sent one */
  lastModified?: string;
}

/**
 * DI token for the optional source archive.
 *
 * Bound the same way OCR_SERVICE is — via `ExtractionModule.forRoot`'s
 * `extraProviders`, because providers declared at an outer module's scope are
 * not visible inside ExtractionModule's own DI scope. Left unbound, fetches
 * simply are not archived.
 */
export const SOURCE_ARCHIVE = "SOURCE_ARCHIVE";

/** Which run and which region a fetch belongs to. */
export interface ArchiveContext {
  /** Region whose sync performed the fetch */
  regionId?: string;
  /** Pipeline data type (propositions, meetings, bills, …) */
  dataType?: string;
  /** PipelineExecution that performed the fetch */
  executionId?: string;
  /** StructuralManifest in force at fetch time */
  manifestId?: string;
}

/**
 * Durable store for fetched artifacts (#1276).
 *
 * An interface rather than a concrete service because extraction-provider must
 * not learn about the database — the implementation lives in the region
 * service, which owns that bounded context.
 *
 * Implementations must not throw: archiving is evidence capture alongside the
 * fetch, and a failure to record must never take down the scrape that was the
 * caller's actual goal.
 */
export interface ISourceArchive {
  archive(
    input: FetchProvenance &
      ArchiveContext & {
        /** Raw bytes exactly as received */
        content: Buffer;
        /** URL that produced them */
        sourceUrl: string;
        /** Response Content-Type, if any */
        contentType?: string;
      },
  ): Promise<ArchiveOutcome>;
}

/**
 * What an archive attempt yielded (#1306).
 *
 * `sourceVersionId` is **optional on purpose**: the store rejects empty and
 * oversized bodies, and an implementation may be unavailable entirely. Absent
 * means "these bytes are not durably stored", and a caller must record no
 * reference rather than a reference to nothing — the same reason #1280 writes
 * an explicit null instead of leaving a stale pointer in place.
 */
export interface ArchiveOutcome {
  /** Row id of the archived artifact, when it was in fact archived. */
  sourceVersionId?: string;
}

/**
 * One fetched artifact, before any caching concern.
 *
 * Generic over the decoded body so the text and binary paths share a single
 * shape — they already share `fetchAndDecode`, and three hand-copied inline
 * return types is how `sourceVersionId` would come to exist on two of them.
 */
export interface FetchedArtifact<T> extends FetchProvenance {
  /** The decoded body */
  content: T;
  /** HTTP status code */
  statusCode: number;
  /** Content-Type header value */
  contentType: string;
  /** The final URL after any redirects (differs from original on redirect) */
  finalUrl?: string;
  /** If the URL was permanently redirected, the original requested URL */
  redirectedFrom?: string;
  /**
   * The archived artifact these bytes were stored as, when `options.archive`
   * asked for one and the store accepted it (#1306).
   */
  sourceVersionId?: string;
}

/** A binary-safe fetch — PDFs, images, archives. */
export type BytesFetchResult = FetchedArtifact<Buffer>;

/**
 * A PDF fetched and turned into text in one call.
 *
 * Carries the archived id alongside the text because the two are separated
 * immediately afterwards: the text becomes `Minutes.rawText` (truncated), and
 * only the archive still holds the whole document (#1276, #1306).
 */
export interface PdfFetchResult {
  /** Extracted text, NUL bytes stripped */
  text: string;
  /** The archived artifact, when the fetch asked for one and it was stored */
  sourceVersionId?: string;
}

/**
 * Result from a cached fetch operation
 */
export interface CachedFetchResult extends FetchProvenance {
  /** The fetched content */
  content: string;
  /** Whether the result was served from cache */
  fromCache: boolean;
  /** HTTP status code (if not from cache) */
  statusCode?: number;
  /** Content-Type header value */
  contentType?: string;
  /** If the URL was permanently redirected, the original requested URL */
  redirectedFrom?: string;
  /** The final URL after any redirects (differs from original on redirect) */
  finalUrl?: string;
  /**
   * The archived artifact these bytes were stored as, when `options.archive`
   * asked for one and the store accepted it (#1306).
   *
   * Survives the result cache deliberately. The cache is keyed on URL and
   * headers, so a later unarchived fetch of the same URL can serve a hit
   * carrying this id — and that is correct, because the id addresses the same
   * bytes and `source_versions` is append-only, so it cannot come to point at
   * something else.
   */
  sourceVersionId?: string;
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
