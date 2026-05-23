import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  QueueService,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import type { RegionSyncJobData } from '@opuspopuli/queue-provider';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { RegionDomainService } from 'src/apps/region/src/domains/region.service';
import { format } from 'date-fns';
import { staggeredCron } from './cadence.utils';

const DAILY_CRON = '0 2 * * *';

@Injectable()
export class RegionSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegionSyncScheduler.name, {
    timestamp: true,
  });

  constructor(
    private readonly queueService: QueueService,
    private readonly pipelineJobService: PipelineJobService,
    private readonly regionService: RegionDomainService,
  ) {}

  async onApplicationBootstrap() {
    const cronEnabled = process.env.REGION_SYNC_CRON_ENABLED !== 'false';
    const runOnStartup = process.env.REGION_SYNC_RUN_ON_STARTUP === 'true';

    if (cronEnabled) {
      await this.registerSchedulers();
    } else {
      this.logger.log(
        'REGION_SYNC_CRON_ENABLED=false — skipping scheduler registration',
      );
    }

    if (runOnStartup) {
      await this.enqueueStartupJob();
    }
  }

  private async registerSchedulers(): Promise<void> {
    const configs = await this.regionService.getPluginDataSourceConfigs();

    const hasCadences = configs.some(({ sources }) =>
      sources.some((s) => s.syncCadence),
    );

    if (!hasCadences) {
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
      return;
    }

    const registeredKeys = new Set<string>();

    for (const { regionId, sources } of configs) {
      for (const source of sources) {
        if (!source.syncCadence) continue;

        const schedulerKey = `${regionId}-${source.dataType}-cron`;
        const cron = staggeredCron(
          source.syncCadence,
          `${regionId}-${source.dataType}`,
        );

        try {
          await this.queueService.upsertScheduler(
            REGION_SYNC_QUEUE,
            schedulerKey,
            cron,
            {
              triggerSource: TRIGGER_SOURCE.CRON,
              regionId,
              dataTypes: [source.dataType as string],
            } satisfies Partial<RegionSyncJobData>,
          );
          registeredKeys.add(schedulerKey);
          this.logger.log(`Registered scheduler ${schedulerKey} (${cron})`);
        } catch (err) {
          this.logger.warn(
            `Failed to register scheduler ${schedulerKey}: ${(err as Error).message}`,
          );
        }
      }
    }

    await this.removeStaleSchedulers(registeredKeys);
  }

  private async removeStaleSchedulers(activeKeys: Set<string>): Promise<void> {
    const existing = await this.queueService.listSchedulers(REGION_SYNC_QUEUE);

    for (const scheduler of existing) {
      if (!activeKeys.has(scheduler.id)) {
        await this.queueService.removeScheduler(
          REGION_SYNC_QUEUE,
          scheduler.id,
        );
        this.logger.log(`Removed stale scheduler ${scheduler.id}`);
      }
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
