import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createWorker, resolveQueuePrefix } from '@opuspopuli/queue-provider';

/**
 * The consumer side of a per-type sync's child jobs (`src/common/child-jobs`):
 * one queue, one job per item, and the job's RETURN VALUE is the item's
 * outcome — the waiting sync reads it off the `completed` event. A thrown
 * error is a failed attempt the queue retries.
 *
 * Concurrency is the worker factory's `BULLMQ_QUEUE_<NAME>_CONCURRENCY`,
 * default 1: the LLM lane queue (S7) decides GPU concurrency on its own.
 */
export abstract class ChildJobProcessor<T, R>
  implements OnApplicationBootstrap, OnModuleDestroy
{
  protected abstract readonly logger: Logger;
  protected abstract readonly queueName: string;
  private worker?: Worker<T>;

  constructor(
    private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  /** One item's work; its result is the item's outcome. */
  protected abstract run(data: T): Promise<R>;

  /** How an item reads in the log — a URL, an id. */
  protected abstract describe(data: T): string;

  onApplicationBootstrap() {
    const prefix = resolveQueuePrefix(this.config.get<string>('BULLMQ_PREFIX'));
    this.worker = createWorker<T>(
      this.queueName,
      this.connection,
      (job) => this.process(job),
      { prefix },
    );
    this.logger.log(`${this.queueName} worker started`);
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log(`${this.queueName} worker closed`);
    }
  }

  private async process(job: Job<T>): Promise<R> {
    const outcome = await this.run(job.data);
    this.logger.debug(
      `${this.queueName} ${this.describe(job.data)}: ${String(outcome)}`,
    );
    return outcome;
  }
}
