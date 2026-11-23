import type { ThrottlerStorage } from '@nestjs/throttler';

/** What `ThrottlerStorage.increment` returns; times are in seconds. */
export interface ThrottleRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

interface Window {
  hits: number;
  windowEndsAt: number;
  blockedUntil: number;
}

/** Default bound on tracked keys; the oldest are dropped beyond it. */
export const DEFAULT_MAX_KEYS = 100_000;
/** Sweep expired windows once every this many increments. */
const SWEEP_EVERY = 1_000;

/**
 * A bounded, fixed-window rate-limit store (#1456).
 *
 * It replaces `@nestjs/throttler`'s in-memory `ThrottlerStorageService`,
 * which has two defects that matter once every visitor gets their own key:
 *
 * - **One client's expiring block resets everyone's decay.** When any key's
 *   block lapses, the stock store clears the decrement timers of every key on
 *   that tier. Other clients' hits then never decay, and ordinary visitors
 *   climb to the limit and are refused. Reproduced against 6.5.0.
 * - **It never deletes a key.** That cost about 1.25 KB per distinct IP,
 *   forever, against a 512 MB gateway: a flood of distinct addresses is a way
 *   to exhaust its memory.
 *
 * Here each key holds one counter and the end of its window, with no timers.
 * Expired windows are swept every {@link SWEEP_EVERY} increments. Past
 * `maxKeys`, the oldest keys are dropped. A dropped key starts again from
 * zero, which errs towards letting a request through and never towards
 * refusing an innocent one.
 *
 * It is single-process, which matches the deployment: one gateway and one
 * instance of each subgraph per node.
 */
export class FixedWindowThrottlerStorage implements ThrottlerStorage {
  private readonly windows = new Map<string, Window>();
  private increments = 0;

  constructor(
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Keys currently tracked; for tests and metrics. */
  get size(): number {
    return this.windows.size;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName?: string,
  ): Promise<ThrottleRecord> {
    const now = this.now();
    this.maybeSweep(now);

    let window = this.windows.get(key);
    if (!window || (now >= window.windowEndsAt && now >= window.blockedUntil)) {
      window = { hits: 0, windowEndsAt: now + ttl, blockedUntil: 0 };
      this.windows.delete(key); // re-insert: newest last, for eviction order
      this.windows.set(key, window);
      this.evictOverflow();
    }

    if (now < window.blockedUntil) {
      return this.record(window, now, true);
    }

    window.hits += 1;
    if (window.hits > limit) {
      window.blockedUntil = now + blockDuration;
      return this.record(window, now, true);
    }
    return this.record(window, now, false);
  }

  private record(
    window: Window,
    now: number,
    blocked: boolean,
  ): ThrottleRecord {
    return {
      totalHits: window.hits,
      timeToExpire: Math.max(0, Math.ceil((window.windowEndsAt - now) / 1000)),
      isBlocked: blocked,
      timeToBlockExpire: blocked
        ? Math.max(1, Math.ceil((window.blockedUntil - now) / 1000))
        : 0,
    };
  }

  private maybeSweep(now: number): void {
    this.increments += 1;
    if (this.increments % SWEEP_EVERY !== 0) return;
    for (const [key, window] of this.windows) {
      if (now >= window.windowEndsAt && now >= window.blockedUntil) {
        this.windows.delete(key);
      }
    }
  }

  private evictOverflow(): void {
    while (this.windows.size > this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) return;
      this.windows.delete(oldest);
    }
  }
}
