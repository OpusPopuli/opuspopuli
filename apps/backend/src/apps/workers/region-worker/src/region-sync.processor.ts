import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  QUEUE_CONNECTION,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
  createWorker,
} from '@opuspopuli/queue-provider';
import type {
  RegionSyncJobData,
  RegionSyncJobResult,
} from '@opuspopuli/queue-provider';
import { Inject } from '@nestjs/common';
import { RegionDomainService } from 'src/apps/region/src/domains/region.service';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { DataTypeGQL } from 'src/apps/region/src/domains/models/region-info.model';

@Injectable()
export class RegionSyncProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RegionSyncProcessor.name, {
    timestamp: true,
  });
  private worker?: Worker<RegionSyncJobData>;

  constructor(
    private readonly regionService: RegionDomainService,
    private readonly pipelineJobService: PipelineJobService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const prefix = this.config.get<string>('BULLMQ_PREFIX') ?? 'bullmq';

    this.worker = createWorker<RegionSyncJobData>(
      REGION_SYNC_QUEUE,
      this.connection,
      (job) => this.process(job),
      { prefix },
    );

    this.logger.log('RegionSyncProcessor worker started');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('RegionSyncProcessor worker closed');
    }
  }

  private async process(
    job: Job<RegionSyncJobData>,
  ): Promise<RegionSyncJobResult[]> {
    const {
      pipelineJobId,
      triggerSource,
      regionId,
      dataTypes,
      depth,
      maxReps,
      maxBills,
      forceStatusRecheck,
    } = job.data;

    this.logger.log(
      {
        queue: REGION_SYNC_QUEUE,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        trigger_source: triggerSource,
        regionId,
      },
      'Processing region-sync job',
    );

    // Cron and manifest-ready jobs have no pre-created DB record — create one now.
    const effectiveJobId =
      pipelineJobId ??
      (
        await this.pipelineJobService.create({
          bullmqJobId: job.id as string,
          triggerSource: triggerSource ?? TRIGGER_SOURCE.CRON,
          regionId,
          dataTypes,
        })
      ).id;

    await this.pipelineJobService.markRunning(effectiveJobId, job.id as string);

    try {
      const results = await this.regionService.syncAll(
        dataTypes,
        maxReps,
        maxBills,
        depth,
        regionId,
        effectiveJobId,
        forceStatusRecheck,
      );

      const gqlResults = results.map((r) => ({
        ...r,
        dataType: r.dataType as unknown as DataTypeGQL,
      }));

      await this.pipelineJobService.markSucceeded(effectiveJobId, gqlResults);

      this.logger.log(
        {
          queue: REGION_SYNC_QUEUE,
          jobId: job.id,
          trigger_source: triggerSource,
          resultCount: results.length,
        },
        'Region-sync job succeeded',
      );

      return results as unknown as RegionSyncJobResult[];
    } catch (err) {
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      if (isLastAttempt) {
        await this.pipelineJobService.markFailed(
          effectiveJobId,
          (err as Error).message,
        );
      }

      this.logger.error(
        {
          queue: REGION_SYNC_QUEUE,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          trigger_source: triggerSource,
          isLastAttempt,
        },
        `Region-sync job failed: ${(err as Error).message}`,
      );

      throw err;
    }
  }
}
