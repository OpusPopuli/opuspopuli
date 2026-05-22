import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_CONNECTION, QUEUE_MODULE_OPTIONS } from "./queue.constants";
import {
  EnqueueOptions,
  QueueJobInfo,
  QueueModuleOptions,
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
    this.logger.debug(`Enqueued job ${job.id} on ${queueName}`);
    return job.id as string;
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
