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

/** Per-host slot — when the next fetch may go out + the configured gap. */
interface HostSlot {
  /** Earliest timestamp the next fetch may execute (ms since epoch). */
  nextSlotMs: number;
  /** Minimum gap between fetches in ms. */
  gapMs: number;
}

/**
 * Per-host minimum-gap throttle. Cheap (single Map keyed by host, no
 * background timers). Bounded de-facto by the number of distinct hosts a
 * process talks to during its lifetime — typically <20 in our setup.
 *
 * Callers `acquire(url)` immediately before issuing the network call.
 * Concurrent calls to the same host are race-safe: each call atomically
 * advances `nextSlotMs` by `gapMs` before sleeping, so N concurrent
 * acquires fan out at N×gap rather than all firing at the first slot.
 *
 * Hosts default to `defaultGapMs` (500ms ≈ 2 req/sec, a balance between
 * gov-site politeness and sync throughput). Callers can override per-host
 * via `setGap` or `setRequestsPerSecond`, typically driven by
 * `DataSourceConfig.rateLimitOverride` (requests-per-second).
 */
export class HostThrottle {
  private readonly hostState = new Map<string, HostSlot>();
  private readonly defaultGapMs: number;

  constructor(defaultGapMs: number = 500) {
    this.defaultGapMs = defaultGapMs;
  }

  /** Set a per-host gap in milliseconds. Idempotent; latest call wins. */
  setGap(host: string, gapMs: number): void {
    if (gapMs <= 0) return;
    const existing = this.hostState.get(host);
    this.hostState.set(host, {
      nextSlotMs: existing?.nextSlotMs ?? 0,
      gapMs,
    });
  }

  /** Translate `rateLimitOverride` (req/sec) to a gap and apply it. */
  setRequestsPerSecond(host: string, reqsPerSec: number): void {
    if (reqsPerSec > 0) {
      this.setGap(host, Math.max(1, Math.round(1000 / reqsPerSec)));
    }
  }

  /**
   * Block until the next allowed fetch slot for this URL's host, then
   * advance the slot. The slot advance happens BEFORE the sleep so
   * concurrent callers each get their own discrete slot — N parallel
   * acquires complete at +0, +gap, +2gap, ... rather than all at +gap.
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
    const now = Date.now();
    const existing = this.hostState.get(host);
    const gapMs = existing?.gapMs ?? this.defaultGapMs;
    const slotMs = Math.max(now, existing?.nextSlotMs ?? 0);
    // Reserve the slot atomically before sleeping so concurrent callers
    // see the advanced timestamp and queue behind us.
    this.hostState.set(host, { nextSlotMs: slotMs + gapMs, gapMs });
    if (slotMs > now) await sleep(slotMs - now);
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
  /** Optional per-host throttle. If provided, `acquire` runs before each
   *  attempt so retries also honor the rate limit. */
  throttle?: HostThrottle;
  /** Optional minimal logger; called once per retry with a warn line. */
  logger?: { warn: (msg: string) => void };
  /** Accepted content-type substrings (default: text/html, xhtml+xml).
   *  Mismatch is a non-retryable error. */
  contentTypeWhitelist?: string[];
  /** Jitter ratio for backoff (default 0.1). Set to 0 in tests. */
  jitterRatio?: number;
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
