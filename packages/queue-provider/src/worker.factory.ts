import { Logger } from "@nestjs/common";
import { DelayedError, Worker, Job, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { resolveQueuePrefix } from "./queue.constants";
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
  const envPrefix = queueName.toUpperCase().replace(/-/g, "_");

  const concurrency =
    Number.parseInt(
      process.env[`BULLMQ_QUEUE_${envPrefix}_CONCURRENCY`] ?? "1",
      10,
    ) || 1;
  const enabled = process.env[`BULLMQ_QUEUE_${envPrefix}_ENABLED`] !== "false";

  if (!enabled) {
    logger.warn(
      `Queue ${queueName} is disabled via env — worker will not process jobs`,
    );
  }

  const lockDurationMs =
    Number.parseInt(
      process.env[`BULLMQ_QUEUE_${envPrefix}_LOCK_DURATION_MS`] ?? "300000",
      10,
    ) || 300000;

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

        opts.metrics?.incrementJobAttempts(queueName, triggerSource, "success");
        opts.metrics?.recordJobDuration(queueName, triggerSource, durationMs);

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

        opts.metrics?.incrementJobAttempts(
          queueName,
          triggerSource,
          isLastAttempt ? "failed" : "retry",
        );
        opts.metrics?.recordJobDuration(queueName, triggerSource, durationMs);

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
