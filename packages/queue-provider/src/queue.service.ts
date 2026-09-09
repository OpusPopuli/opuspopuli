import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS } from "./queue.constants";
import {
  EnqueueOptions,
  QueueJobInfo,
  QueueModuleOptions,
  SchedulerInfo,
} from "./queue.types";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly prefix: string;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    @Inject(QUEUE_MODULE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {
    this.prefix = options.prefix ?? "bullmq";
  }

  async enqueue<T>(
    queueName: string,
    data: T,
    opts?: EnqueueOptions,
  ): Promise<string> {
    const queue = this.getQueue(queueName);
    const jobOpts = this.buildJobOptions(queueName, opts);
    const job = await queue.add(queueName, data, jobOpts);

    // A caller-supplied jobId that is already taken makes `add()` a no-op:
    // BullMQ returns the EXISTING job rather than enqueuing, in any state
    // including `completed` (retained here for 7 days). The call still
    // resolves, so a caller that only logs "enqueued" reports success for
    // work that will never run — exactly how #1172 stayed invisible.
    //
    // `finishedOn` is only set on a job that has already run, so its
    // presence on a just-"added" job is proof we collided with an old one.
    if (jobOpts.jobId && job.finishedOn) {
      this.logger.warn(
        `Enqueue was a NO-OP on ${queueName}: jobId "${jobOpts.jobId}" is ` +
          `already held by a job that finished at ` +
          `${new Date(job.finishedOn).toISOString()}. Nothing was queued. ` +
          `Deterministic jobIds must be unique per unit of work, not per ` +
          `caller — include whatever makes this request distinct.`,
      );
    } else {
      this.logger.debug(`Enqueued job ${job.id} on ${queueName}`);
    }
    return job.id as string;
  }

  /**
   * Bulk-enqueue many jobs in a single Redis round-trip. Each entry has
   * its own optional `EnqueueOptions` so callers can mix deterministic
   * jobIds (dedup) with auto-generated ones in one call.
   *
   * Used by fan-out schedulers (LLM rerank cron, future per-user jobs)
   * where the per-user loop would otherwise do N round-trips and block
   * the worker for many seconds at scale.
   */
  async enqueueBulk<T>(
    queueName: string,
    entries: { data: T; opts?: EnqueueOptions }[],
  ): Promise<string[]> {
    if (entries.length === 0) return [];
    const queue = this.getQueue(queueName);
    const bulkJobs = entries.map((e) => ({
      name: queueName,
      data: e.data,
      opts: this.buildJobOptions(queueName, e.opts),
    }));
    const jobs = await queue.addBulk(bulkJobs);
    this.logger.debug(`Bulk-enqueued ${jobs.length} jobs on ${queueName}`);
    return jobs.map((j) => j.id as string);
  }

  async getJobInfo(
    queueName: string,
    jobId: string,
  ): Promise<QueueJobInfo | null> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    return {
      id: job.id as string,
      state,
      progress: typeof job.progress === "number" ? job.progress : 0,
      failedReason: job.failedReason ?? undefined,
    };
  }

  async upsertScheduler(
    queueName: string,
    schedulerId: string,
    cron: string,
    data: unknown,
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.upsertJobScheduler(schedulerId, { pattern: cron }, { data });
    this.logger.log(
      `Upserted scheduler ${schedulerId} on ${queueName} (cron: ${cron})`,
    );
  }

  async listSchedulers(queueName: string): Promise<SchedulerInfo[]> {
    const queue = this.getQueue(queueName);
    const schedulers = await queue.getJobSchedulers();
    return schedulers.map((s) => ({
      id: s.key,
      pattern: s.pattern ?? "",
      next: s.next ?? null,
    }));
  }

  async removeScheduler(queueName: string, schedulerId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.removeJobScheduler(schedulerId);
    this.logger.log(`Removed scheduler ${schedulerId} from ${queueName}`);
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection.quit();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private getQueue(queueName: string): Queue {
    if (!this.queues.has(queueName)) {
      this.queues.set(
        queueName,
        new Queue(queueName, {
          connection: this.connection,
          prefix: this.prefix,
          defaultJobOptions: {
            removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
            removeOnFail: { age: 60 * 60 * 24 * 30 },
          },
        }),
      );
    }
    return this.queues.get(queueName)!;
  }

  private buildJobOptions(
    queueName: string,
    opts?: EnqueueOptions,
  ): JobsOptions {
    const envPrefix = queueName.toUpperCase().replace(/-/g, "_");
    const attempts = parseInt(
      process.env[`BULLMQ_QUEUE_${envPrefix}_ATTEMPTS`] ?? "3",
      10,
    );
    const backoffMs = parseInt(
      process.env[`BULLMQ_QUEUE_${envPrefix}_BACKOFF_MS`] ?? "30000",
      10,
    );

    return {
      attempts,
      backoff: { type: "exponential", delay: backoffMs },
      jobId: opts?.jobId,
      delay: opts?.delay,
      priority: opts?.priority,
    };
  }
}
