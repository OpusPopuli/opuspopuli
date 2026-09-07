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
import { BoundaryLoaderService } from 'src/apps/region/src/domains/boundary-loader.service';
import { DataTypeGQL } from 'src/apps/region/src/domains/models/region-info.model';
import { DataType, type SyncResult } from '@opuspopuli/common';

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
    private readonly boundaryLoader: BoundaryLoaderService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const prefix = this.config.get<string>('BULLMQ_PREFIX') ?? 'bullmq';

    // Recover rows that were RUNNING when the previous worker died/crashed
    // (BullMQ stall + worker death leaves them stuck). Threshold is the
    // BullMQ lock-renewal window plus a safety margin — anything older is
    // definitely abandoned. See opuspopuli#730.
    const DEFAULT_STALE_AGE_MS = 600_000;
    const rawStaleAge = this.config.get<string>('PIPELINE_JOB_STALE_AGE_MS');
    const parsedStaleAge = rawStaleAge
      ? Number.parseInt(rawStaleAge, 10)
      : DEFAULT_STALE_AGE_MS;
    const staleAgeMs =
      Number.isFinite(parsedStaleAge) && parsedStaleAge > 0
        ? parsedStaleAge
        : DEFAULT_STALE_AGE_MS;
    if (rawStaleAge && staleAgeMs !== parsedStaleAge) {
      this.logger.warn(
        `Ignoring invalid PIPELINE_JOB_STALE_AGE_MS="${rawStaleAge}", using default ${DEFAULT_STALE_AGE_MS}ms`,
      );
    }
    try {
      const swept = await this.pipelineJobService.sweepStaleRunning(staleAgeMs);
      if (swept > 0) {
        this.logger.warn(
          `Swept ${swept} stale RUNNING pipeline_jobs row(s) older than ${staleAgeMs}ms on startup`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Stale-row sweep failed (non-fatal): ${(err as Error).message}`,
      );
    }

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
      maxDocuments,
      resetWatermark,
    } = job.data;

    // Build the archive-ingest override only when the operator supplied one,
    // so a normal sync is unaffected (undefined → source-config maxNew, no
    // watermark reset).
    const archiveOptions =
      maxDocuments != null || resetWatermark != null
        ? { maxDocuments, resetWatermark }
        : undefined;

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
      const results = await this.runRequestedSyncs(
        job.data,
        effectiveJobId,
        archiveOptions,
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

  /**
   * Dispatch a region-sync job to the work it actually requested (#1122).
   *
   * Boundary refresh rides this same queue as its own data type but does
   * NOT go through the plugin-driven civic `syncAll` path, so the two are
   * partitioned rather than branched: a `boundaries` type runs the loader,
   * every other type runs `syncAll`, and a job that mixes them (e.g.
   * `[representatives, boundaries]`) runs BOTH — dropping the civic types
   * on the boundary branch would silently under-sync while still reporting
   * SUCCEEDED. An undefined `dataTypes` means "sync every civic type", the
   * pre-#1122 default, and never triggers a boundary load on its own.
   */
  private async runRequestedSyncs(
    data: RegionSyncJobData,
    effectiveJobId: string,
    archiveOptions:
      | { maxDocuments?: number; resetWatermark?: boolean }
      | undefined,
  ): Promise<SyncResult[]> {
    const {
      dataTypes,
      regionId,
      maxReps,
      maxBills,
      depth,
      forceStatusRecheck,
      force,
    } = data;
    const results: SyncResult[] = [];

    if (dataTypes?.includes(DataTypeGQL.BOUNDARIES)) {
      results.push(...(await this.loadBoundaries(force ?? false, regionId)));
    }

    // Civic types = everything except boundaries. Undefined dataTypes keeps
    // the "sync all civic types" default; an explicit boundaries-only job
    // yields an empty civic list and skips syncAll entirely.
    const civicTypes = dataTypes?.filter(
      (type) => type !== DataTypeGQL.BOUNDARIES,
    );
    if (!dataTypes || (civicTypes && civicTypes.length > 0)) {
      results.push(
        ...(await this.regionService.syncAll(
          civicTypes,
          maxReps,
          maxBills,
          depth,
          regionId,
          effectiveJobId,
          forceStatusRecheck,
          archiveOptions,
        )),
      );
    }

    return results;
  }

  /**
   * Run the boundary loader for a `boundaries` job (#1122) and shape its
   * counts as a single `RegionSyncJobResult` so the shared job lifecycle
   * (markSucceeded, poll) reports it exactly like a civic sync:
   *   - itemsCreated  = rows upserted this run
   *   - itemsSkipped  = rows dropped for want of an idempotency key
   *   - errors        = one line when any row failed to upsert
   * `existing` (prior boundary count) is carried in the log, not the result.
   */
  private async loadBoundaries(
    force: boolean,
    regionId?: string,
  ): Promise<SyncResult[]> {
    const result = await this.boundaryLoader.loadAll({ force });
    const { existing, upserted, failed, missingKey } = result.counts;

    let label = regionId ?? 'active';
    try {
      label = regionId ?? this.regionService.getRegionInfo().id;
    } catch {
      // No active region resolvable — fall back to the label above.
    }

    return [
      {
        regionId: label,
        dataType: DataType.BOUNDARIES,
        itemsProcessed: upserted + failed + missingKey,
        itemsCreated: upserted,
        itemsUpdated: 0,
        itemsSkipped: missingKey,
        errors:
          failed > 0
            ? [
                `${failed} boundary row(s) failed to upsert (existing=${existing})`,
              ]
            : [],
        syncedAt: new Date(),
      },
    ];
  }
}
