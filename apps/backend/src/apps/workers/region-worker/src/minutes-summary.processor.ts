import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  MINUTES_SUMMARY_QUEUE,
  QUEUE_CONNECTION,
  createWorker,
} from '@opuspopuli/queue-provider';
import type { MinutesSummaryJobData } from '@opuspopuli/queue-provider';
import { MinutesSummaryService } from 'src/apps/region/src/domains/minutes-summary.service';

/**
 * Consumes the minutes-summary queue (#813): one job per minutes row, runs
 * the LLM synopsis + claims generation via {@link MinutesSummaryService}.
 * Fire-and-forget — BullMQ's removeOnComplete/removeOnFail retention covers
 * job status; there's no dedicated status table for MVP.
 */
@Injectable()
export class MinutesSummaryProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MinutesSummaryProcessor.name, {
    timestamp: true,
  });
  private worker?: Worker<MinutesSummaryJobData>;

  constructor(
    private readonly minutesSummary: MinutesSummaryService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const prefix = this.config.get<string>('BULLMQ_PREFIX') ?? 'bullmq';
    this.worker = createWorker<MinutesSummaryJobData>(
      MINUTES_SUMMARY_QUEUE,
      this.connection,
      (job) => this.process(job),
      { prefix },
    );
    this.logger.log('MinutesSummaryProcessor worker started');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('MinutesSummaryProcessor worker closed');
    }
  }

  private async process(job: Job<MinutesSummaryJobData>): Promise<boolean> {
    const { minutesId, externalId, force } = job.data;
    const wrote = await this.minutesSummary.summarize(
      minutesId,
      force ?? false,
    );
    this.logger.debug(
      `minutes-summary ${externalId ?? minutesId}: ${wrote ? 'written' : 'skipped'}`,
    );
    return wrote;
  }
}
