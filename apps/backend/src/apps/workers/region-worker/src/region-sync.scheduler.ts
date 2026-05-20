import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  QueueService,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import type { RegionSyncJobData } from '@opuspopuli/queue-provider';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { format } from 'date-fns';

const DAILY_CRON = '0 2 * * *';

@Injectable()
export class RegionSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegionSyncScheduler.name, {
    timestamp: true,
  });

  constructor(
    private readonly queueService: QueueService,
    private readonly pipelineJobService: PipelineJobService,
  ) {}

  async onApplicationBootstrap() {
    const cronEnabled = process.env.REGION_SYNC_CRON_ENABLED !== 'false';
    const runOnStartup = process.env.REGION_SYNC_RUN_ON_STARTUP === 'true';

    if (cronEnabled) {
      await this.queueService.upsertScheduler(
        REGION_SYNC_QUEUE,
        'daily-cron',
        DAILY_CRON,
        {
          triggerSource: TRIGGER_SOURCE.CRON,
        } satisfies Partial<RegionSyncJobData>,
      );
      this.logger.log(
        `Registered daily-cron scheduler on ${REGION_SYNC_QUEUE} (${DAILY_CRON})`,
      );
    } else {
      this.logger.log(
        'REGION_SYNC_CRON_ENABLED=false — skipping scheduler registration',
      );
    }

    if (runOnStartup) {
      await this.enqueueStartupJob();
    }
  }

  private async enqueueStartupJob() {
    const yyyymmdd = format(new Date(), 'yyyyMMdd');
    const jobId = `startup-${yyyymmdd}`;

    const row = await this.pipelineJobService.create({
      bullmqJobId: jobId,
      triggerSource: TRIGGER_SOURCE.STARTUP,
    });

    const data: RegionSyncJobData = {
      pipelineJobId: row.id,
      triggerSource: TRIGGER_SOURCE.STARTUP,
    };

    await this.queueService.enqueue(REGION_SYNC_QUEUE, data, { jobId });
    this.logger.log(`Enqueued startup region-sync job (jobId=${jobId})`);
  }
}
