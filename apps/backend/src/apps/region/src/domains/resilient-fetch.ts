/**
 * Rate-limit-aware HTTP fetch with exponential backoff + per-host throttle.
 *
 * Backs the region sync's per-bill page fetches. Replaces a bare `fetch()`
 * that left the worker exposed to leginfo 503s and BullMQ stall loops —
 * see opuspopuli#730.
 *
 * The per-host rate limit is passed in, not owned here: it is the shared
 * `IHostRateLimiter` (S1), whose buckets and policies live in Redis so every
 * process and DI scope enforces one budget per government site. This file's
 * own `HostThrottle` was per process — N processes, N× the rate a site saw —
 * and is gone.
 */

import {
  type IHostRateLimiter,
  type MetricsObserver,
  PipelineStage,
  withStage,
} from '@opuspopuli/common';

/** Sleep helper — pulled out so tests can stub setTimeout cleanly. */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marker error for HTTP responses the retry helper should retry (5xx, 429).
 * Replaces an earlier pattern of mutating a generic `Error` with a
 * `retryable` flag — using a real class lets `isFetchRetryable` check
 * via `instanceof` and gives the type system something to reason about.
 */
export class RetryableHttpError extends Error {
  readonly retryable = true as const;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RetryableHttpError';
  }
}

/**
 * Run `fn`, retrying transient failures with exponential backoff. Throws
 * the last error after `maxAttempts`. Final delay is capped at `maxDelayMs`.
 *
 * `isRetryable` decides which errors are eligible; non-retryable errors
 * propagate immediately. `onRetry` is invoked before each backoff so
 * callers can log without coupling to a logger interface.
 *
 * `jitterRatio` (default 0.1 ≈ ±10%) adds randomization to spread out
 * concurrent retries — relevant if multiple workers ever scale out.
 * Set to 0 in tests for deterministic delays.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;
  const jitterRatio = opts.jitterRatio ?? 0.1;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const base = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter =
        jitterRatio > 0 ? 1 - jitterRatio + Math.random() * 2 * jitterRatio : 1;
      const delayMs = Math.round(base * jitter);
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  // Unreachable, but TypeScript can't prove it.
  throw lastErr;
}

/**
 * Default retryability for HTTP fetches: RetryableHttpError, timeouts,
 * abort signals, and transport-level errors (ECONNRESET, ECONNREFUSED,
 * EAI_AGAIN, "fetch failed", "socket hang up", "terminated").
 */
export function isFetchRetryable(err: unknown): boolean {
  if (err instanceof RetryableHttpError) return true;
  const e = err as { name?: string; message?: string };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return true;
  const msg = e?.message ?? '';
  return (
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up') ||
    msg.includes('terminated') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('EAI_AGAIN')
  );
}

export interface FetchTextOptions {
  /** Hard timeout for each individual attempt. Default 20000ms. Kept
   *  well below the BullMQ default lock duration so a hung fetch can't
   *  break worker lock renewal. */
  timeoutMs?: number;
  /** Max attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base delay for exponential backoff in ms. Default 2000. */
  baseDelayMs?: number;
  /** Optional per-host rate limit. If provided, `acquire` runs before each
   *  attempt so retries also honor the rate limit. */
  throttle?: Pick<IHostRateLimiter, 'acquire'>;
  /** Optional minimal logger; called once per retry with a warn line. */
  logger?: { warn: (msg: string) => void };
  /** Accepted content-type substrings (default: text/html, xhtml+xml).
   *  Mismatch is a non-retryable error. */
  contentTypeWhitelist?: string[];
  /** Jitter ratio for backoff (default 0.1). Set to 0 in tests. */
  jitterRatio?: number;
  /**
   * Where to report the time this fetch took (M1,
   * `docs/plans/ingestion-resource-lanes.md` §2). Absent means span-only.
   */
  metrics?: MetricsObserver;
  /**
   * Which sync this fetch belongs to, for the `data_type` label.
   *
   * Optional because this helper is shared and genuinely does not always
   * know — and a guessed label is worse than an absent one, being wrong in a
   * way no query can detect.
   */
  dataType?: string;
}

/**
 * Fetch a URL as text with throttling, retry on transient failure, and
 * content-type validation. Drop-in replacement for the bare
 * `fetch(url).then(r => r.text())` pattern with HTML constraints.
 */
export async function fetchTextWithRetry(
  url: string,
  opts: FetchTextOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const allowed = opts.contentTypeWhitelist ?? ['text/html', 'xhtml+xml'];

  // Around the WHOLE retry sequence, not each attempt. If leginfo is 503ing
  // and this sleeps 2s then 4s before succeeding, those six seconds were
  // spent fetching — they belong in the stage total, or a sync's stages stop
  // summing to its duration and the missing time looks like it went nowhere.
  // Per-attempt network latency is a different question, and the span this
  // emits is where to ask it.
  return withStage(
    PipelineStage.Fetch,
    { dataType: opts.dataType },
    () => fetchTextOnce(url, timeoutMs, allowed, opts),
    { observer: opts.metrics },
  );
}

/** One throttled, retried, content-type-checked fetch. */
async function fetchTextOnce(
  url: string,
  timeoutMs: number,
  allowed: string[],
  opts: FetchTextOptions,
): Promise<string> {
  return withRetry(
    async () => {
      if (opts.throttle) await opts.throttle.acquire(url);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Transient server-side or rate-limit: retryable.
      if (response.status >= 500 || response.status === 429) {
        throw new RetryableHttpError(
          response.status,
          `HTTP ${response.status} fetching ${url}: ${response.statusText}`,
        );
      }

      // Other 4xx: non-retryable client error.
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} fetching ${url}: ${response.statusText}`,
        );
      }

      const ct = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!allowed.some((a) => ct.includes(a))) {
        throw new Error(`Non-HTML content-type for ${url}: ${ct}`);
      }

      // The body stream can also error mid-read (network blip after
      // headers arrived). isFetchRetryable handles the common shapes
      // (`terminated`, `socket hang up`, etc.) so the retry path triggers.
      return response.text();
    },
    {
      maxAttempts: opts.maxAttempts ?? 3,
      baseDelayMs: opts.baseDelayMs ?? 2000,
      jitterRatio: opts.jitterRatio,
      isRetryable: isFetchRetryable,
      onRetry: (err, attempt, delayMs) => {
        opts.logger?.warn(
          `fetch retry ${attempt} for ${url} after ${delayMs}ms: ${(err as Error).message}`,
        );
      },
    },
  );
}
