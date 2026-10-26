import type { ChildJobBatch, ChildOutcome } from './child-job-batch';

/**
 * One long-lived batch serving many callers that each queue a job and await
 * ITS outcome — the shape a per-item lane needs when the item is requested
 * deep inside other work (a PDF parse requested by the detail crawl, S6),
 * not fanned out by a sync. Same rules as the batch: listen before queueing,
 * never read a finished job back.
 *
 * Callers asking for the same job id share one outcome. A caller that waits
 * longer than `timeoutMs` gets a failed outcome; the job carries on, and its
 * late outcome is dropped.
 */
/** The start of a timed-out outcome's `reason` — what {@link isWaitTimeout} tests. */
const TIMEOUT_REASON = 'no outcome within';

/** Whether an outcome is a caller's wait running out, not the job's own failure. */
export function isWaitTimeout(outcome: ChildOutcome<unknown>): boolean {
  return !outcome.ok && outcome.reason.startsWith(TIMEOUT_REASON);
}

export class ChildJobWaiter<T, R> {
  private batch?: Promise<ChildJobBatch<T, R>>;
  private readonly waiting = new Map<string, Promise<ChildOutcome<R>>>();
  private readonly resolvers = new Map<string, (o: ChildOutcome<R>) => void>();
  private pumping = false;
  private closed = false;

  constructor(private readonly open: () => Promise<ChildJobBatch<T, R>>) {}

  run(jobId: string, data: T, timeoutMs: number): Promise<ChildOutcome<R>> {
    if (this.closed) {
      return Promise.resolve({ jobId, ok: false, reason: 'waiter closed' });
    }
    const shared = this.waiting.get(jobId);
    if (shared) return shared;
    const outcome = new Promise<ChildOutcome<R>>((resolve) => {
      const timer = setTimeout(
        () =>
          this.settle({
            jobId,
            ok: false,
            reason: `${TIMEOUT_REASON} ${timeoutMs}ms`,
          }),
        timeoutMs,
      );
      // A wait must not hold a shutting-down process open.
      timer.unref();
      this.resolvers.set(jobId, (o) => {
        clearTimeout(timer);
        resolve(o);
      });
    });
    this.waiting.set(jobId, outcome);
    // `queue` settles its own failures as this caller's outcome.
    this.queue(jobId, data).catch(() => undefined);
    return outcome;
  }

  /**
   * Stop: every caller still waiting gets a failed outcome now rather than at
   * its timeout, and a later `run` fails at once instead of reopening a batch
   * nothing would close.
   */
  async close(): Promise<void> {
    this.closed = true;
    for (const jobId of [...this.resolvers.keys()]) {
      this.settle({ jobId, ok: false, reason: 'waiter closed' });
    }
    const batch = this.batch;
    this.batch = undefined;
    // A batch that never opened has nothing to close — and must not fail
    // the shutdown it is part of.
    await batch?.then((b) => b.close()).catch(() => undefined);
  }

  private async queue(jobId: string, data: T): Promise<void> {
    let opened: Promise<ChildJobBatch<T, R>> | undefined;
    try {
      opened = this.batch ??= this.open();
      const batch = await opened;
      // Anything already reported for THIS id predates this caller — its job
      // is not added yet: the late outcome of a wait that timed out, or the
      // removal of its job. Delivered, it would settle this caller at once,
      // so drop it. Other ids' outcomes go to their callers as usual.
      for (const early of batch.take()) {
        if (early.jobId !== jobId) this.settle(early);
      }
      await batch.add(data, jobId);
      this.pumpSafely();
    } catch (error) {
      // A batch that failed to OPEN is not kept: caching the rejection would
      // fail every later call at once, until a restart. The next call opens
      // afresh.
      if (this.batch === opened) {
        const failedOpen = await opened?.then(
          () => false,
          () => true,
        );
        if (failedOpen) this.batch = undefined;
      }
      this.settle({ jobId, ok: false, reason: (error as Error).message });
    }
  }

  /**
   * Run the pump, and if it fails (Redis gone mid-wait) fail its callers now
   * rather than leave them to their timeouts.
   */
  private pumpSafely(): void {
    this.pump().catch((error: unknown) => {
      for (const jobId of [...this.resolvers.keys()]) {
        this.settle({ jobId, ok: false, reason: (error as Error).message });
      }
    });
  }

  /** One loop, while anyone is waiting, handing each outcome to its caller. */
  private async pump(): Promise<void> {
    if (this.pumping || !this.batch) return;
    this.pumping = true;
    try {
      const batch = await this.batch;
      while (this.resolvers.size > 0 && !this.closed) {
        await batch.waitForOutcome(1_000);
        for (const outcome of batch.take()) this.settle(outcome);
      }
    } finally {
      this.pumping = false;
    }
  }

  private settle(outcome: ChildOutcome<R>): void {
    const resolve = this.resolvers.get(outcome.jobId);
    if (!resolve) return;
    this.resolvers.delete(outcome.jobId);
    this.waiting.delete(outcome.jobId);
    resolve(outcome);
  }
}
