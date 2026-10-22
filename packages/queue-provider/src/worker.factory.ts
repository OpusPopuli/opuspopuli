import { Logger } from "@nestjs/common";
import { Worker, Job, WorkerOptions } from "bullmq";
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
}

export function createWorker<T>(
  queueName: string,
  connection: IORedis,
  handler: (job: Job<T>) => Promise<unknown>,
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
    concurrency,
    autorun: enabled,
    lockDuration: lockDurationMs,
  };

  const worker = new Worker<T>(
    queueName,
    async (job: Job<T>) => {
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
        const result = await withJobSpan(queueName, job, () => handler(job));
        const durationMs = Date.now() - startMs;

        opts.metrics?.incrementJobAttempts(queueName, triggerSource, "success");
        opts.metrics?.recordJobDuration(queueName, triggerSource, durationMs);

        logger.log(
          {
            queue: queueName,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            trigger_source: triggerSource,
            durationMs,
          },
          "Job succeeded",
        );
        return result;
      } catch (err) {
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
