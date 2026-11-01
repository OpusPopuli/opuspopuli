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
  resolveQueuePrefix,
} from '@opuspopuli/queue-provider';
import type { MinutesSummaryJobData } from '@opuspopuli/queue-provider';
import type { GeneratedOutputOutcome } from 'src/apps/region/src/domains/generated-output-key';
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
  /** Config pairs already reported, so a mismatch warns once, not per job. */
  private readonly reportedMismatches = new Set<string>();

  constructor(
    private readonly minutesSummary: MinutesSummaryService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const prefix = resolveQueuePrefix(this.config.get<string>('BULLMQ_PREFIX'));
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

  private async process(
    job: Job<MinutesSummaryJobData>,
  ): Promise<GeneratedOutputOutcome> {
    const { minutesId, externalId, force } = job.data;
    this.checkSelectionConfig(job.data.selectedUnderConfigHash);
    const outcome = await this.minutesSummary.summarize(
      minutesId,
      force ?? false,
    );
    this.logger.debug(`minutes-summary ${externalId ?? minutesId}: ${outcome}`);
    return outcome;
  }

  /**
   * Warn when the service that selected this job keyed currency under other
   * settings (meetings-phase-b.md §4d). Each side then judges stale what the
   * other wrote: region queues jobs that end `unchanged` here, every sync.
   * Absent on jobs queued before the field existed.
   */
  private checkSelectionConfig(selected: string | undefined): void {
    const own = this.minutesSummary.configHash();
    if (!selected || selected === own) return;
    const pair = `${selected}/${own}`;
    if (this.reportedMismatches.has(pair)) return;
    this.reportedMismatches.add(pair);
    this.logger.warn(
      `minutes-summary: selected under config ${selected.slice(0, 12)}, but this worker's is ` +
        `${own.slice(0, 12)}; set MINUTES_SUMMARY_MAX_TOKENS the same on region and region-worker`,
    );
  }
}
