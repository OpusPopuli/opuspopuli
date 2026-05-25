/**
 * Rate-limit-aware HTTP fetch with exponential backoff + per-host throttle.
 *
 * Backs the region sync's per-bill page fetches. Replaces a bare `fetch()`
 * that left the worker exposed to leginfo 503s and BullMQ stall loops —
 * see opuspopuli#730.
 *
 * The two pieces are decoupled on purpose:
 *   - `HostThrottle` enforces a minimum gap between requests per hostname
 *   - `fetchTextWithRetry` adds exponential backoff + content-type check
 *
 * Either can be used independently; together they protect long-running
 * sync loops from rate-limited or flaky gov sites without burning out a
 * BullMQ worker's lock-renewal heartbeat.
 */

/** Sleep helper — pulled out so tests can stub setTimeout cleanly. */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-host minimum-gap throttle. Cheap (constant memory per host, no
 * background timers). Callers `acquire(url)` immediately before issuing
 * the network call; the throttle waits if the configured gap hasn't
 * elapsed since the previous fetch to the same host.
 *
 * Hosts default to `defaultGapMs` (1000ms ≈ 1 req/sec, conservative for
 * gov sites). Callers can override per-host via `setGap`, typically
 * driven by `DataSourceConfig.rateLimitOverride` (requests-per-second).
 */
export class HostThrottle {
  private readonly lastFetchByHost = new Map<string, number>();
  private readonly gapByHost = new Map<string, number>();
  private readonly defaultGapMs: number;

  constructor(defaultGapMs: number = 1000) {
    this.defaultGapMs = defaultGapMs;
  }

  /** Set a per-host gap in milliseconds. Idempotent; latest call wins. */
  setGap(host: string, gapMs: number): void {
    if (gapMs > 0) this.gapByHost.set(host, gapMs);
  }

  /** Translate `rateLimitOverride` (req/sec) to a gap and apply it. */
  setRequestsPerSecond(host: string, reqsPerSec: number): void {
    if (reqsPerSec > 0) {
      this.setGap(host, Math.max(1, Math.round(1000 / reqsPerSec)));
    }
  }

  /**
   * Block until enough time has elapsed since the last fetch to this URL's
   * host. Updates the last-fetch timestamp on return so a long-running fn
   * after acquire() doesn't compound delay for the next call.
   *
   * Malformed URLs silently skip throttling — the underlying fetch will
   * surface the URL error.
   */
  async acquire(url: string): Promise<void> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    const gap = this.gapByHost.get(host) ?? this.defaultGapMs;
    const last = this.lastFetchByHost.get(host);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      const remaining = gap - elapsed;
      if (remaining > 0) await sleep(remaining);
    }
    this.lastFetchByHost.set(host, Date.now());
  }
}

/**
 * Run `fn`, retrying transient failures with exponential backoff. Throws
 * the last error after `maxAttempts`. Final delay is capped at `maxDelayMs`.
 *
 * `isRetryable` decides which errors are eligible; non-retryable errors
 * propagate immediately. `onRetry` is invoked before each backoff so
 * callers can log without coupling to a logger interface.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 5000;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  // Unreachable, but TypeScript can't prove it.
  throw lastErr;
}

/**
 * Default retryability for HTTP fetches: 5xx, 429, timeouts, and
 * network-level errors (ECONNRESET, ECONNREFUSED, fetch failed).
 */
export function isFetchRetryable(err: unknown): boolean {
  const e = err as { retryable?: boolean; name?: string; message?: string };
  if (e?.retryable === true) return true;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return true;
  const msg = e?.message ?? '';
  return (
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
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
  /** Base delay for exponential backoff in ms. Default 5000. */
  baseDelayMs?: number;
  /** Optional per-host throttle. If provided, `acquire` runs before each
   *  attempt so retries also honor the rate limit. */
  throttle?: HostThrottle;
  /** Optional minimal logger; called once per retry with a warn line. */
  logger?: { warn: (msg: string) => void };
  /** Accepted content-type substrings (default: text/html, xhtml+xml).
   *  Mismatch is a non-retryable error. */
  contentTypeWhitelist?: string[];
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

  return withRetry(
    async () => {
      if (opts.throttle) await opts.throttle.acquire(url);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Transient server-side or rate-limit: retryable.
      if (response.status >= 500 || response.status === 429) {
        const err = new Error(
          `HTTP ${response.status} fetching ${url}: ${response.statusText}`,
        );
        (err as Error & { retryable?: boolean }).retryable = true;
        throw err;
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

      return response.text();
    },
    {
      maxAttempts: opts.maxAttempts ?? 3,
      baseDelayMs: opts.baseDelayMs ?? 5000,
      isRetryable: isFetchRetryable,
      onRetry: (err, attempt, delayMs) => {
        opts.logger?.warn(
          `fetch retry ${attempt} for ${url} after ${delayMs}ms: ${(err as Error).message}`,
        );
      },
    },
  );
}
