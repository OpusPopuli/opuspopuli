import { Logger } from "@nestjs/common";
import { DelayedError, Worker, Job, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import {
  queueEnvInt,
  queueEnvKey,
  resolveQueuePrefix,
} from "./queue.constants";
import { withJobSpan } from "./job-tracing";

export interface WorkerMetrics {
  incrementJobAttempts(
    queue: string,
    triggerSource: string,
    outcome: string,
  ): void;
  recordJobDuration(
    queue: string,
    triggerSource: string,
    durationMs: number,
  ): void;
}

let defaultWorkerMetrics: WorkerMetrics | undefined;

/**
 * The job metrics every worker in this process reports to, unless its caller
 * passes its own — bound once by the app's metrics module, so a new queue is
 * measured without anyone remembering to thread an observer into it. Before
 * this, `WorkerMetrics` had no implementation and every queue's attempts and
 * durations went nowhere.
 */
export function setDefaultWorkerMetrics(
  metrics: WorkerMetrics | undefined,
): void {
  defaultWorkerMetrics = metrics;
}

/**
 * Whether THIS process consumes `queueName`, by `WORKER_QUEUES` — the role
 * switch that makes multi-host a configuration change
 * (`docs/plans/propositions-phase-b.md`, fetch and CPU lanes).
 *
 * A comma list: `*` (every queue — the default, as before), a queue name, a
 * `prefix*`, and `!name` / `!prefix*` to exclude. A queue is consumed when
 * some positive entry matches and no exclusion does. A CPU host runs
 * `WORKER_QUEUES=pdf-parse`; the host that requests parses runs
 * `WORKER_QUEUES=*,!pdf-parse`.
 *
 * Distinct from `BULLMQ_QUEUE_<NAME>_ENABLED`, which switches a queue off
 * EVERYWHERE (its producers then do the work in process): this decides only
 * which process takes the jobs.
 */
export function workerQueueSelected(
  queueName: string,
  spec: string | undefined = process.env.WORKER_QUEUES,
): boolean {
  const entries = (spec?.trim() ? spec : "*")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const matches = (pattern: string) =>
    pattern.endsWith("*")
      ? queueName.startsWith(pattern.slice(0, -1))
      : queueName === pattern;
  const excluded = entries.some(
    (e) => e.startsWith("!") && matches(e.slice(1)),
  );
  const included = entries.some((e) => !e.startsWith("!") && matches(e));
  return included && !excluded;
}

/**
 * `BULLMQ_QUEUE_<NAME>_CONCURRENCY`, default 1 — how many jobs a queue's
 * worker runs at once. Exported so a consumer that sizes its own resources to
 * the worker (the S6 CPU lane's thread pool) reads the same number.
 */
export function queueConcurrency(queueName: string): number {
  return queueEnvInt(queueName, "CONCURRENCY", 1);
}

/**
 * Whether this process runs `queueName`'s jobs — the queue switched on
 * everywhere, and selected here by `WORKER_QUEUES` — saying why when not.
 */
function resolveConsumption(queueName: string, logger: Logger): boolean {
  const queueOn = process.env[queueEnvKey(queueName, "ENABLED")] !== "false";
  if (!queueOn) {
    logger.warn(
      `Queue ${queueName} is disabled via env — worker will not process jobs`,
    );
    return false;
  }
  if (!workerQueueSelected(queueName)) {
    // Normal on a multi-host node: another process consumes this queue.
    logger.log(
      `Queue ${queueName} is consumed by another process (WORKER_QUEUES) — not here`,
    );
    return false;
  }
  return true;
}

export interface CreateWorkerOptions {
  prefix?: string;
  metrics?: WorkerMetrics;
  /**
   * Overrides for a caller that knows better than the env defaults — the
   * env knobs remain for every other queue. Needed because a queue name with
   * dots (the S7 lane queues, named from a host) makes the env names
   * `BULLMQ_QUEUE_<NAME>_*` unexportable from a shell.
   */
  concurrency?: number;
  lockDuration?: number;
  /** 0 = a stalled job fails rather than re-running on another consumer. */
  maxStalledCount?: number;
  /**
   * Log success at debug, not log — for a queue whose jobs are sub-steps of
   * another job (one lane job per LLM call: thousands per bills sync).
   * Failures are still logged as errors.
   */
  quiet?: boolean;
}

/**
 * BullMQ's own test: by class, or by name — a second copy of bullmq in the
 * tree makes `instanceof` fail for an error its worker still honours.
 */
export function isDelayed(error: unknown): boolean {
  return (
    error instanceof DelayedError ||
    (error as { name?: unknown } | null)?.name === "DelayedError"
  );
}

export function createWorker<T>(
  queueName: string,
  connection: IORedis,
  /**
   * `token` is the worker's lock token for the job — what `job.moveToDelayed`
   * needs to put a job back without failing it (S2's per-type lock).
   */
  handler: (job: Job<T>, token?: string) => Promise<unknown>,
  opts: CreateWorkerOptions = {},
): Worker<T> {
  const logger = new Logger(`Worker:${queueName}`);
  const metrics = opts.metrics ?? defaultWorkerMetrics;
  const concurrency = queueConcurrency(queueName);
  const enabled = resolveConsumption(queueName, logger);
  const lockDurationMs = queueEnvInt(queueName, "LOCK_DURATION_MS", 300000);

  const workerOpts: WorkerOptions = {
    connection,
    prefix: resolveQueuePrefix(opts.prefix),
    concurrency: opts.concurrency ?? concurrency,
    autorun: enabled,
    lockDuration: opts.lockDuration ?? lockDurationMs,
    ...(opts.maxStalledCount !== undefined
      ? { maxStalledCount: opts.maxStalledCount }
      : {}),
  };

  const worker = new Worker<T>(
    queueName,
    async (job: Job<T>, token?: string) => {
      const triggerSource =
        ((job.data as Record<string, unknown>)?.triggerSource as string) ??
        "unknown";
      const startMs = Date.now();

      logger.debug(
        `Processing job ${job.id} (attempt ${job.attemptsMade + 1}) trigger=${triggerSource}`,
      );

      try {
        // The job's span is a child of the enqueue's (D7), and every
        // `withStage()` span the handler opens lands under it — so one trace
        // covers the request, the queue hop and the work itself.
        const result = await withJobSpan(queueName, job, () =>
          handler(job, token),
        );
        const durationMs = Date.now() - startMs;

        metrics?.incrementJobAttempts(queueName, triggerSource, "success");
        metrics?.recordJobDuration(queueName, triggerSource, durationMs);

        const succeeded = {
          queue: queueName,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          trigger_source: triggerSource,
          durationMs,
        };
        if (opts.quiet) logger.debug(succeeded, "Job succeeded");
        else logger.log(succeeded, "Job succeeded");
        return result;
      } catch (err) {
        // A job the handler moved back to the delayed set: not a failure, and
        // it costs no attempt — BullMQ just needs the error to know.
        if (isDelayed(err)) {
          logger.debug(`Job ${job.id} moved back to delayed`);
          throw err;
        }
        const durationMs = Date.now() - startMs;
        const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

        metrics?.incrementJobAttempts(
          queueName,
          triggerSource,
          isLastAttempt ? "failed" : "retry",
        );
        metrics?.recordJobDuration(queueName, triggerSource, durationMs);

        logger.error(
          {
            queue: queueName,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            trigger_source: triggerSource,
            durationMs,
          },
          `Job failed: ${(err as Error).message}`,
        );
        throw err;
      }
    },
    workerOpts,
  );

  worker.on("error", (err) => {
    logger.error({ queue: queueName }, `Worker error: ${err.message}`);
  });

  return worker;
}
