import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import {
  QueueService,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import type {
  RegionSyncJobData,
  TriggerSource,
} from '@opuspopuli/queue-provider';
import { randomUUID } from 'crypto';
import { PipelineJobService } from './pipeline-job.service';

/**
 * Region Scheduler
 *
 * Fires the daily 2 AM cron from the region service side. Enqueues a
 * region-sync job onto the BullMQ queue for retry/backoff/observability.
 *
 * When REGION_SYNC_CRON_VIA_QUEUE=true the worker's RegionSyncScheduler
 * registers a BullMQ repeatable job directly — this class returns early
 * to avoid double-enqueue.
 */
@Injectable()
export class RegionScheduler {
  private readonly logger = new Logger(RegionScheduler.name, {
    timestamp: true,
  });
  private readonly syncEnabled: boolean;
  private readonly syncCronViaQueue: boolean;
  private readonly syncRunOnStartup: boolean;

  constructor(
    private readonly queueService: QueueService,
    private readonly pipelineJobService: PipelineJobService,
    private readonly configService: ConfigService,
  ) {
    this.syncEnabled =
      this.configService.get<string>('REGION_SYNC_ENABLED') !== 'false';
    this.syncCronViaQueue =
      this.configService.get<string>('REGION_SYNC_CRON_VIA_QUEUE') === 'true';
    this.syncRunOnStartup =
      this.configService.get<string>('REGION_SYNC_RUN_ON_STARTUP') === 'true';
  }

  async onModuleInit() {
    if (!this.syncRunOnStartup || this.syncCronViaQueue) {
      return;
    }
    this.logger.log(
      'Enqueueing startup sync (REGION_SYNC_RUN_ON_STARTUP=true)',
    );
    await this.enqueueSync(TRIGGER_SOURCE.STARTUP);
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleScheduledSync() {
    if (!this.syncEnabled || this.syncCronViaQueue) {
      return;
    }
    this.logger.log('Enqueueing scheduled cron sync');
    await this.enqueueSync(TRIGGER_SOURCE.CRON);
  }

  private async enqueueSync(triggerSource: TriggerSource) {
    try {
      const jobId = randomUUID();
      const row = await this.pipelineJobService.create({
        bullmqJobId: jobId,
        triggerSource,
      });
      await this.queueService.enqueue<RegionSyncJobData>(
        REGION_SYNC_QUEUE,
        { pipelineJobId: row.id, triggerSource },
        { jobId },
      );
      this.logger.log(
        `Region sync enqueued (jobId=${jobId}, trigger=${triggerSource})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ${triggerSource} sync: ${(error as Error).message}`,
      );
    }
  }
}
