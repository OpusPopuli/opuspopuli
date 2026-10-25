import { Logger } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import type IORedis from 'ioredis';
import type { QueueService } from '@opuspopuli/queue-provider';

/**
 * Fan out, then wait — the shape a per-type sync uses to move per-item LLM
 * work onto its own queue while still finishing after that work does
 * (civics S3, `docs/plans/civics-phase-b.md` §3; the other data types reuse
 * it).
 *
 * The parent keeps its lock, its counts and any once-per-run step (civics'
 * glossary prune) meaning what they did when the work ran inline, because it
 * does not return until every job it queued has reported.
 *
 * It listens before it queues and never reads a finished job back. (The
 * stream's first read goes out one round trip after the batch opens; an
 * event inside that window — a job finishing within a round trip of its add
 * — would be missed and end as an idle-timeout failure, not lost data.) Jobs are
 * removed the moment they finish (so a deterministic id collapses only onto
 * work still in flight), and BullMQ reports a removed job as *missing* —
 * which `waitUntilFinished` turns into a failure. The outcome arrives on the
 * `completed`/`failed` event instead, carrying the return value. `failed`
 * fires once per job, when its attempts are exhausted: a retry emits
 * `waiting`, not `failed`.
 */

/** What one job reported. */
export type ChildOutcome<R> =
  | { jobId: string; ok: true; value: R }
  | { jobId: string; ok: false; reason: string };

export interface ChildJobBatch<T, R> {
  /**
   * Queue one job under `jobId`. An id already in flight — this batch's, or
   * a previous run's that a restart left behind — collapses onto that job,
   * whose outcome is then this one's.
   */
  add(data: T, jobId: string): Promise<void>;
  /** The outcomes that have arrived since the last call, in arrival order. */
  take(): ChildOutcome<R>[];
  /** Jobs queued and not yet reported. */
  readonly pending: number;
  /** Resolve once an outcome arrives, or after `ms`. */
  waitForOutcome(ms: number): Promise<void>;
  /**
   * Remove every job that has not started — those will never report. A job
   * already running cannot be removed without leaving its worker running
   * (`QueueService.removeJobIfPending`), so it stays pending.
   */
  dropWaiting(): Promise<number>;
  /**
   * Report every still-pending job as failed with `reason`, and remove the
   * ones that have not started, so a consumer arriving later does not run
   * work already counted as failed.
   */
  failPending(reason: string): Promise<void>;
  close(): Promise<void>;
}

/** How a {@link settleChildJobs} wait ended. */
export type SettleEnd = 'settled' | 'cancelled' | 'timed-out';

export interface SettleOptions<R> {
  /** Every outcome, as it arrives. May throw — e.g. a consecutive-failure abort. */
  onOutcome: (outcome: ChildOutcome<R>) => void;
  /** Checked between outcomes; true drops the waiting jobs. */
  isCancelled?: () => Promise<boolean>;
  /** Longest gap between two outcomes before the rest are given up on. */
  idleTimeoutMs: number;
  /** How often cancellation is checked while nothing arrives. */
  pollMs?: number;
}

const DEFAULT_POLL_MS = 30_000;

/**
 * Longest a sync waits between two child outcomes before giving the rest up
 * as failed: the LLM lane's own wait bound (`LLM_LANE_WAIT_TIMEOUT_MS`, 6 h by
 * default), since a child cannot take longer than its LLM call may wait.
 */
export function laneIdleTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.LLM_LANE_WAIT_TIMEOUT_MS ?? '',
    10,
  );
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : 6 * 60 * 60 * 1000;
}

const logger = new Logger('ChildJobBatch');

/**
 * Wait for every job in the batch, handing each outcome to `onOutcome` as it
 * arrives.
 *
 * Cancellation drops the jobs that have not started and waits out the ones
 * that have — a parent that returned with work still running would release
 * its lock over it. An idle timeout reports what is left as failed, so a
 * consumer that never comes cannot hold the parent for ever.
 */
export async function settleChildJobs<T, R>(
  batch: ChildJobBatch<T, R>,
  options: SettleOptions<R>,
): Promise<SettleEnd> {
  const pollMs = Math.min(
    options.pollMs ?? DEFAULT_POLL_MS,
    options.idleTimeoutMs,
  );
  let end: SettleEnd = 'settled';
  let lastOutcomeAt = Date.now();
  for (;;) {
    const arrived = batch.take();
    if (arrived.length > 0) lastOutcomeAt = Date.now();
    arrived.forEach(options.onOutcome);
    if (batch.pending === 0) return end;
    if (end === 'settled' && (await options.isCancelled?.())) {
      end = 'cancelled';
      await batch.dropWaiting();
      continue;
    }
    if (Date.now() - lastOutcomeAt >= options.idleTimeoutMs) {
      await batch.failPending(
        `no outcome within ${options.idleTimeoutMs}ms — is a ` +
          `consumer running for this queue?`,
      );
      batch.take().forEach(options.onOutcome);
      return 'timed-out';
    }
    await batch.waitForOutcome(pollMs);
  }
}

/**
 * After a parent stops early (an abort, an error): drop what has not
 * started, and wait out what has, discarding outcomes — so the parent still
 * ends after its work does. Never throws; the parent is already failing.
 */
export async function abandonChildJobs<T, R>(
  batch: ChildJobBatch<T, R>,
  idleTimeoutMs: number,
): Promise<void> {
  try {
    await batch.dropWaiting();
    await settleChildJobs(batch, { onOutcome: () => undefined, idleTimeoutMs });
  } catch {
    // Nothing to add: the caller's own error is the one worth reporting.
  }
}

/**
 * A batch on a BullMQ queue: jobs go through {@link QueueService.enqueue}
 * (trace context, per-queue attempts and backoff), removed on finish.
 */
export async function openQueueBatch<T, R>(deps: {
  queueService: QueueService;
  connection: IORedis;
  prefix: string;
  queueName: string;
}): Promise<ChildJobBatch<T, R>> {
  const { queueService, queueName } = deps;
  // QueueEvents duplicates the connection it is given (the event stream is a
  // blocking read) and closes that duplicate itself.
  const events = new QueueEvents(queueName, {
    connection: deps.connection,
    prefix: deps.prefix,
  });
  try {
    await events.waitUntilReady();
  } catch (error) {
    await events.close().catch(() => undefined);
    throw error;
  }

  const pending = new Set<string>();
  // Ids this batch is removing itself: their `removed` event is not news.
  const dropping = new Set<string>();
  const arrived: ChildOutcome<R>[] = [];
  let wake: (() => void) | undefined;
  const report = (outcome: ChildOutcome<R>): void => {
    if (!pending.delete(outcome.jobId)) return;
    arrived.push(outcome);
    wake?.();
    wake = undefined;
  };
  events.on('completed', ({ jobId, returnvalue }) =>
    report({ jobId, ok: true, value: returnvalue as R }),
  );
  events.on('failed', ({ jobId, failedReason }) =>
    report({ jobId, ok: false, reason: failedReason }),
  );
  // Removed by someone else — an operator's clean, a dashboard — it will
  // never report, and waiting for it would hold the parent to the timeout.
  events.on('removed', ({ jobId }) => {
    if (!dropping.has(jobId)) {
      report({ jobId, ok: false, reason: 'removed from the queue' });
    }
  });
  // A Redis blip mid-sync, through the logger rather than bare stderr.
  events.on('error', (error) =>
    logger.warn(`${queueName} event stream: ${error.message}`),
  );

  /**
   * Remove a job that has not started. A job a worker claims between the
   * state read and the remove is locked, and the remove throws: that is
   * "not removed" — the job runs and reports — not a reason to fail the run.
   */
  const removeIfWaiting = async (jobId: string): Promise<boolean> => {
    try {
      return await queueService.removeJobIfPending(queueName, jobId);
    } catch {
      return false;
    }
  };

  return {
    async add(data, jobId) {
      // Pending BEFORE the add: a fast job can finish before `enqueue`
      // resolves, and its event must find the id.
      pending.add(jobId);
      try {
        await queueService.enqueue(queueName, data, {
          jobId,
          removeOnFinish: true,
        });
      } catch (error) {
        pending.delete(jobId);
        throw error;
      }
    },
    take: () => arrived.splice(0),
    get pending() {
      return pending.size;
    },
    // At once when something already arrived — an event can land while the
    // caller was busy (a cancellation read), after the last wake was spent.
    waitForOutcome: (ms) =>
      arrived.length > 0
        ? Promise.resolve()
        : waitOrTimeout(ms, (resolve) => (wake = resolve)),
    // Known gap, cancel path only: a job that finishes and is auto-removed
    // between the state read and the remove is "removed" with no event, so
    // its page goes uncounted in a run that is ending anyway.
    async dropWaiting() {
      let dropped = 0;
      for (const jobId of [...pending]) {
        dropping.add(jobId);
        if (await removeIfWaiting(jobId)) {
          pending.delete(jobId);
          dropped++;
        } else {
          dropping.delete(jobId);
        }
      }
      return dropped;
    },
    async failPending(reason) {
      const given = [...pending];
      for (const jobId of given) report({ jobId, ok: false, reason });
      for (const jobId of given) await removeIfWaiting(jobId);
    },
    close: () => events.close(),
  };
}

/**
 * A batch that runs each job as it is added, in this process — the shape a
 * sync takes when no queue is bound (a unit test, or the queue turned off by
 * `BULLMQ_QUEUE_<NAME>_ENABLED=false`). A thrown error is a failed outcome,
 * as a job's would be.
 */
export function inlineBatch<T, R>(
  run: (data: T) => Promise<R>,
): ChildJobBatch<T, R> {
  const arrived: ChildOutcome<R>[] = [];
  return {
    async add(data, jobId) {
      try {
        arrived.push({ jobId, ok: true, value: await run(data) });
      } catch (error) {
        arrived.push({ jobId, ok: false, reason: (error as Error).message });
      }
    },
    take: () => arrived.splice(0),
    pending: 0,
    waitForOutcome: async () => undefined,
    dropWaiting: async () => 0,
    failPending: async () => undefined,
    close: async () => undefined,
  };
}

function waitOrTimeout(
  ms: number,
  register: (resolve: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    register(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
