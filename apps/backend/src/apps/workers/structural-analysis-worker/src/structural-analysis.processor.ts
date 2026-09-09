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

      await this.enqueueFollowUpSync(
        regionId,
        dataType,
        manifestId,
        manifestVersion,
      );

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
   *
   * The jobId is scoped to the MANIFEST, not just (regionId, dataType)
   * — see #1172. It previously omitted the manifest, and the comment
   * claimed BullMQ "silently skips if already queued/active". BullMQ
   * actually no-ops a duplicate jobId in *any* state including
   * `completed`, and completed jobs are retained for 7 days
   * (`removeOnComplete.age` in queue.service.ts). So the id stayed
   * occupied by the previous run and every follow-up inside that window
   * was dropped, while `enqueue()` returned normally and the log below
   * still claimed success.
   *
   * That is the mechanism the deferred cold-start path depends on: the
   * first sync primes the manifest and returns 0 items, and this
   * follow-up is what actually extracts. Losing it leaves the source
   * empty behind a `succeeded` job — observed on UAT 2026-09-07 and in
   * production 2026-09-08 (Sonoma propositions, 12 measures stranded
   * behind an already-built manifest).
   *
   * Including the version matters because a re-analysis can bump a
   * manifest in place; a new version is a new reason to sync.
   */
  private async enqueueFollowUpSync(
    regionId: string,
    dataType: string,
    manifestId: string,
    manifestVersion: number,
  ): Promise<void> {
    try {
      // Still deterministic — concurrent analyses of the SAME manifest
      // collapse to one follow-up, which was the original intent.
      const dedupeJobId = `manifest-ready:${regionId}:${dataType}:${manifestId}:v${manifestVersion}`;

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
