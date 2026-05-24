import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  QUEUE_CONNECTION,
  REGION_SYNC_QUEUE,
  STRUCTURAL_ANALYSIS_QUEUE,
  TRIGGER_SOURCE,
  QueueService,
  createWorker,
} from '@opuspopuli/queue-provider';
import type {
  RegionSyncJobData,
  StructuralAnalysisJobData,
  StructuralAnalysisJobResult,
  AnalysisRequestSource,
} from '@opuspopuli/queue-provider';
import { ScrapingPipelineService } from '@opuspopuli/scraping-pipeline';
import { StructuralAnalysisJobService } from 'src/apps/region/src/domains/structural-analysis-job.service';

@Injectable()
export class StructuralAnalysisProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StructuralAnalysisProcessor.name, {
    timestamp: true,
  });
  private worker?: Worker<StructuralAnalysisJobData>;

  constructor(
    private readonly pipeline: ScrapingPipelineService,
    private readonly jobService: StructuralAnalysisJobService,
    private readonly queueService: QueueService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const prefix = this.config.get<string>('BULLMQ_PREFIX') ?? 'bullmq';

    this.worker = createWorker<StructuralAnalysisJobData>(
      STRUCTURAL_ANALYSIS_QUEUE,
      this.connection,
      (job) => this.process(job),
      { prefix },
    );

    this.logger.log('StructuralAnalysisProcessor worker started');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('StructuralAnalysisProcessor worker closed');
    }
  }

  private async process(
    job: Job<StructuralAnalysisJobData>,
  ): Promise<StructuralAnalysisJobResult> {
    const {
      structuralAnalysisJobId,
      regionId,
      sourceUrl,
      dataType,
      contentGoal,
      category,
      hints,
      requestedBy,
    } = job.data;

    this.logger.log(
      {
        queue: STRUCTURAL_ANALYSIS_QUEUE,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        regionId,
        sourceUrl,
        dataType,
      },
      'Processing structural-analysis job',
    );

    await this.jobService.markRunning(
      structuralAnalysisJobId,
      job.id as string,
      {
        regionId,
        sourceUrl,
        dataType,
        requestedBy: requestedBy as AnalysisRequestSource,
      },
    );

    const startTime = Date.now();
    try {
      const { manifestId, manifestVersion } =
        await this.pipeline.performManifestAnalysis(
          regionId,
          sourceUrl,
          dataType,
          contentGoal,
          category,
          hints,
        );

      const analysisTimeMs = Date.now() - startTime;
      await this.jobService.markSucceeded(structuralAnalysisJobId, manifestId);

      this.logger.log(
        {
          queue: STRUCTURAL_ANALYSIS_QUEUE,
          jobId: job.id,
          regionId,
          sourceUrl,
          manifestId,
          manifestVersion,
          analysisTimeMs,
        },
        'Structural-analysis job succeeded',
      );

      await this.enqueueFollowUpSync(regionId, dataType);

      return { manifestId, manifestVersion, analysisTimeMs };
    } catch (err) {
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      if (isLastAttempt) {
        await this.jobService.markFailed(
          structuralAnalysisJobId,
          (err as Error).message,
        );
      }

      this.logger.error(
        {
          queue: STRUCTURAL_ANALYSIS_QUEUE,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          regionId,
          sourceUrl,
          isLastAttempt,
        },
        `Structural-analysis job failed: ${(err as Error).message}`,
      );

      throw err;
    }
  }

  /**
   * Enqueue a targeted region-sync job after a manifest is written.
   * Uses a deterministic jobId so BullMQ deduplicates concurrent analyses
   * for the same (regionId, dataType) — only one follow-up sync is queued.
   */
  private async enqueueFollowUpSync(
    regionId: string,
    dataType: string,
  ): Promise<void> {
    try {
      // Deterministic jobId deduplicates concurrent analyses for the same
      // (regionId, dataType) — BullMQ silently skips if already queued/active.
      const dedupeJobId = `manifest-ready:${regionId}:${dataType}`;

      await this.queueService.enqueue<RegionSyncJobData>(
        REGION_SYNC_QUEUE,
        {
          triggerSource: TRIGGER_SOURCE.MANIFEST_READY,
          regionId,
          dataTypes: [dataType],
        },
        { jobId: dedupeJobId },
      );

      this.logger.log(
        `Enqueued follow-up region-sync for ${regionId}/${dataType} after manifest ready`,
      );
    } catch (err) {
      // Log but don't fail the analysis job — the operator can re-trigger sync manually
      this.logger.warn(
        `Failed to enqueue follow-up sync for ${regionId}/${dataType}: ${(err as Error).message}`,
      );
    }
  }
}
