import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DelayedError, Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  JOB_STATUS,
  QUEUE_CONNECTION,
  QueueService,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
  createWorker,
  resolveQueuePrefix,
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
import { DataTypeLock, type HeldLock } from './data-type-lock';

/**
 * How long a job whose type is already syncing waits before trying again.
 * `REGION_SYNC_LOCK_RETRY_MS` overrides it.
 */
const DEFAULT_LOCKED_RETRY_MS = 60_000;

/** BullMQ's default for `region-sync` jobs' own lock (`createWorker`). */
const DEFAULT_JOB_LOCK_MS = 300_000;

/** Queue states a job never leaves: its `queued` row will not be run. */
const FINISHED_JOB_STATES = new Set(['completed', 'failed']);

/**
 * How long a `queued` row must have waited before a missing or finished
 * queue job makes it an orphan. A day: well past any lock retry or startup
 * job, and short enough that a lost row is corrected by the next deploy.
 */
const ORPHANED_QUEUED_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Anything but exactly one type is a parent that fans out into one job per
 * type (S2): no types means every type; an empty list means none, and closes
 * at once. A single-type job — every cron — runs as itself.
 */
function isFanOut(data: RegionSyncJobData): boolean {
  return data.dataTypes?.length !== 1;
}

/** Whether this delivery is the job's last chance. */
function isLastAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Bills first: the longest, so it starts while the rest run beside it. */
function billsFirst(types: string[]): string[] {
  return [...types].sort(
    (a, b) => Number(b === DataType.BILLS) - Number(a === DataType.BILLS),
  );
}

interface ChildRow {
  id: string;
  bullmqJobId: string;
  dataType: string;
  status: string;
}

/**
 * A child's job data: the parent's, for one type. Named field by field, not
 * spread: the parent's data carries its own trace context, which the
 * enqueue re-injects for the child.
 */
function childJobData(
  data: RegionSyncJobData,
  parentId: string,
  child: ChildRow,
): RegionSyncJobData {
  return {
    pipelineJobId: child.id,
    parentJobId: parentId,
    triggerSource: data.triggerSource,
    regionId: data.regionId,
    dataTypes: [child.dataType],
    depth: data.depth,
    maxReps: data.maxReps,
    maxBills: data.maxBills,
    forceStatusRecheck: data.forceStatusRecheck,
    maxDocuments: data.maxDocuments,
    resetWatermark: data.resetWatermark,
    force: data.force,
  };
}

@Injectable()
export class RegionSyncProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RegionSyncProcessor.name, {
    timestamp: true,
  });
  private worker?: Worker<RegionSyncJobData>;
  private lock?: DataTypeLock;
  private lockedRetryMs = DEFAULT_LOCKED_RETRY_MS;

  constructor(
    private readonly regionService: RegionDomainService,
    private readonly pipelineJobService: PipelineJobService,
    private readonly boundaryLoader: BoundaryLoaderService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
    private readonly queueService: QueueService,
  ) {}

  async onApplicationBootstrap() {
    const prefix = resolveQueuePrefix(this.config.get<string>('BULLMQ_PREFIX'));

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
      // S2: a request whose last child's own settle failed stays `running`
      // with nothing left to close it.
      const settled = await this.pipelineJobService.settleFinishedParents();
      if (settled > 0) {
        this.logger.warn(
          `Closed ${settled} region-sync request(s) whose jobs had all finished`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Stale-row sweep failed (non-fatal): ${(err as Error).message}`,
      );
    }
    await this.sweepOrphanedQueued();

    // The type lock lives as long as the job's own: shorter, a stall the job
    // survives would let a second sync of the type start beside it.
    this.lock = new DataTypeLock(
      this.connection,
      prefix,
      positiveInt(
        this.config.get<string>('BULLMQ_QUEUE_REGION_SYNC_LOCK_DURATION_MS'),
        DEFAULT_JOB_LOCK_MS,
      ),
    );
    this.lockedRetryMs = positiveInt(
      this.config.get<string>('REGION_SYNC_LOCK_RETRY_MS'),
      DEFAULT_LOCKED_RETRY_MS,
    );
    this.worker = createWorker<RegionSyncJobData>(
      REGION_SYNC_QUEUE,
      this.connection,
      (job, token) => this.process(job, token),
      { prefix },
    );

    this.logger.log('RegionSyncProcessor worker started');
  }

  /**
   * §4g: a `queued` row whose queue job is gone is never picked up, and the
   * running sweep only sees `running`. Separate from it, so neither failing
   * skips the other — nor the parent settle between them.
   */
  private async sweepOrphanedQueued(): Promise<void> {
    try {
      const orphaned = await this.pipelineJobService.sweepOrphanedQueued(
        ORPHANED_QUEUED_AGE_MS,
        async (id) => {
          const info = await this.queueService.getJobInfo(
            REGION_SYNC_QUEUE,
            id,
          );
          // A finished job is retained for days (failed: 30), but nothing
          // will run it again: its row is as orphaned as one with no job.
          return info !== null && !FINISHED_JOB_STATES.has(info.state);
        },
      );
      if (orphaned > 0) {
        this.logger.warn(
          `Failed ${orphaned} pipeline_jobs row(s) queued over a day with no pending queue job`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Orphaned-queued sweep failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('RegionSyncProcessor worker closed');
    }
  }

  /**
   * Has this job been cancelled since it was enqueued?
   *
   * Fails OPEN. This check is a safety feature, and a safety feature that
   * takes down the queue when the database hiccups is a worse outcome than
   * the one it guards against: running a cancelled job costs one wasted run,
   * while refusing to process anything costs every run.
   */
  private async wasCancelled(pipelineJobId: string): Promise<boolean> {
    try {
      return await this.pipelineJobService.isCancelled(pipelineJobId);
    } catch (error) {
      this.logger.warn(
        { pipelineJobId, err: (error as Error).message },
        'Could not read job cancellation state; proceeding',
      );
      return false;
    }
  }

  private async process(
    job: Job<RegionSyncJobData>,
    token?: string,
  ): Promise<RegionSyncJobResult[]> {
    const { pipelineJobId, triggerSource, regionId, dataTypes } = job.data;

    this.logger.debug(
      {
        queue: REGION_SYNC_QUEUE,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        trigger_source: triggerSource,
        regionId,
      },
      // Debug: a job waiting on its type's lock comes back every minute.
      'Processing region-sync job',
    );

    // Cron and manifest-ready jobs have no pre-created DB record — create one
    // now, or find the one a previous delivery created: a redelivered
    // request must not become a second request and fan out again (S2).
    const effectiveJobId =
      pipelineJobId ??
      (
        await this.pipelineJobService.findByBullmqJobId(
          job.id as string,
          new Date(job.timestamp),
        )
      )?.id ??
      (
        await this.pipelineJobService.create({
          bullmqJobId: job.id as string,
          triggerSource: triggerSource ?? TRIGGER_SOURCE.CRON,
          regionId,
          dataTypes,
        })
      ).id;

    // Checked BEFORE any work, and before markRunning would flip the row back
    // to `running`. BullMQ re-delivers a stalled job whenever a worker
    // restarts, so a cancelled job would otherwise begin again from item 1 on
    // every boot — which is what left hand-editing Redis as the only way to
    // stop a bad run on 2026-09-22.
    if (await this.wasCancelled(effectiveJobId)) {
      this.logger.warn(
        {
          queue: REGION_SYNC_QUEUE,
          jobId: job.id,
          pipelineJobId: effectiveJobId,
        },
        'Skipping cancelled region-sync job',
      );
      // A child created just after its request was cancelled escaped the
      // cancel's fan-out: close its own row too, or it waits `queued` for
      // ever (conditional — a row already cancelled is left as it is).
      if (job.data.parentJobId) {
        await this.pipelineJobService.cancel(
          effectiveJobId,
          'its request was cancelled',
        );
      }
      await this.settleParentOf(job.data);
      return [];
    }

    if (isFanOut(job.data)) {
      await this.fanOut(job, effectiveJobId);
      return [];
    }
    return this.runSingleType(job, token, effectiveJobId);
  }

  /**
   * Run one data type's sync, holding that type's lock (S2).
   *
   * Taken before `markRunning`, so a job waiting its turn still reads
   * `queued`. When another sync of the type holds it, the job goes back to
   * the delayed set — which costs no attempt — rather than running beside
   * it.
   */
  private async runSingleType(
    job: Job<RegionSyncJobData>,
    token: string | undefined,
    effectiveJobId: string,
  ): Promise<RegionSyncJobResult[]> {
    const [dataType] = job.data.dataTypes ?? [];
    if (!this.lock || !dataType) {
      throw new Error('region-sync worker not started, or a job with no type');
    }
    const held = await this.acquireOrFail(job, dataType, effectiveJobId);
    if (!held) {
      // Debug: a job waiting behind a 48 h bills run comes back every minute.
      this.logger.debug(
        { queue: REGION_SYNC_QUEUE, jobId: job.id, dataType },
        'Another sync of this type is running; waiting',
      );
      await job.moveToDelayed(Date.now() + this.lockedRetryMs, token);
      throw new DelayedError();
    }
    try {
      return await this.runLocked(job, effectiveJobId);
    } finally {
      await held.release();
      await this.settleParentOf(job.data);
    }
  }

  /**
   * The type lock, or null when another sync holds it. A Redis error on the
   * job's last attempt fails the row — and settles its parent — rather than
   * leaving it `queued` for a job that will never run again.
   */
  private async acquireOrFail(
    job: Job<RegionSyncJobData>,
    dataType: string,
    effectiveJobId: string,
  ): Promise<HeldLock | null> {
    try {
      return await this.lock!.acquire(dataType);
    } catch (error) {
      if (isLastAttempt(job)) {
        await this.pipelineJobService.markFailed(
          effectiveJobId,
          `Could not take the ${dataType} sync lock: ${(error as Error).message}`,
        );
        await this.settleParentOf(job.data);
      }
      throw error;
    }
  }

  private async runLocked(
    job: Job<RegionSyncJobData>,
    effectiveJobId: string,
  ): Promise<RegionSyncJobResult[]> {
    const { triggerSource, maxDocuments, resetWatermark } = job.data;
    // Build the archive-ingest override only when the operator supplied one,
    // so a normal sync is unaffected (undefined → source-config maxNew, no
    // watermark reset).
    const archiveOptions =
      maxDocuments != null || resetWatermark != null
        ? { maxDocuments, resetWatermark }
        : undefined;

    await this.pipelineJobService.markRunning(effectiveJobId, job.id as string);
    this.logger.log(
      {
        queue: REGION_SYNC_QUEUE,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        trigger_source: triggerSource,
        dataTypes: job.data.dataTypes,
      },
      'Region-sync job started',
    );

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
      const lastAttempt = isLastAttempt(job);

      if (lastAttempt) {
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
          isLastAttempt: lastAttempt,
        },
        `Region-sync job failed: ${(err as Error).message}`,
      );

      throw err;
    }
  }

  /**
   * Turn a request for no type, or several, into one job per type (S2).
   *
   * The parent is marked running only from QUEUED or RUNNING: one already
   * closed (a redelivery after it settled) or cancelled since its check fans
   * out nothing more. Every child row is created before any child is
   * enqueued — a child that finished while its siblings did not yet exist
   * would settle the parent early — and only children still `queued` are
   * enqueued, so a redelivery re-runs nothing that already ran. The parent
   * then returns, never holding a slot its children need; the last child to
   * finish settles it, and so does this, in case every child already had.
   */
  private async fanOut(
    job: Job<RegionSyncJobData>,
    parentId: string,
  ): Promise<void> {
    // Child rows created but not yet enqueued: on a final failure these, and
    // only these, would wait `queued` for a job that does not exist.
    const unenqueued = new Set<string>();
    try {
      await this.fanOutChildren(job, parentId, unenqueued);
    } catch (error) {
      if (isLastAttempt(job)) {
        const reason = `Fan-out failed: ${(error as Error).message}`;
        await this.pipelineJobService.failChildren([...unenqueued], reason);
        await this.pipelineJobService.markFailed(parentId, reason);
        await this.pipelineJobService.settleParent(parentId);
      }
      throw error;
    }
  }

  private async fanOutChildren(
    job: Job<RegionSyncJobData>,
    parentId: string,
    unenqueued: Set<string>,
  ): Promise<void> {
    const data = job.data;
    const parent = await this.pipelineJobService.markParentRunning(
      parentId,
      job.id as string,
    );
    if (!parent) return;
    const types = billsFirst(
      data.dataTypes
        ? [...new Set(data.dataTypes)]
        : await this.regionService.syncableDataTypes(data.depth, data.regionId),
    );
    if (types.length === 0) {
      await this.pipelineJobService.markSucceeded(parentId, []);
      return;
    }

    const children: ChildRow[] = [];
    for (const dataType of types) {
      const child = await this.ensureChild(
        parentId,
        dataType,
        data,
        parent.enqueuedBy,
      );
      if (child.status === JOB_STATUS.QUEUED) unenqueued.add(child.id);
      children.push(child);
    }
    for (const child of children) {
      if (!unenqueued.has(child.id)) continue;
      await this.queueService.enqueue(
        REGION_SYNC_QUEUE,
        childJobData(data, parentId, child),
        { jobId: child.bullmqJobId },
      );
      unenqueued.delete(child.id);
    }
    this.logger.log(
      {
        queue: REGION_SYNC_QUEUE,
        jobId: job.id,
        pipelineJobId: parentId,
        children: types,
      },
      'Region-sync request fanned out, one job per data type',
    );
    await this.pipelineJobService.settleParent(parentId);
  }

  /** The child row for one type, found if a previous delivery made it. */
  private async ensureChild(
    parentId: string,
    dataType: string,
    data: RegionSyncJobData,
    enqueuedBy: string | null,
  ): Promise<ChildRow> {
    const existing = await this.pipelineJobService.findChild(
      parentId,
      dataType,
    );
    if (existing) return { ...existing, dataType };
    const bullmqJobId = `${parentId}-${dataType}`;
    const { id } = await this.pipelineJobService.create({
      parentJobId: parentId,
      bullmqJobId,
      triggerSource: data.triggerSource ?? TRIGGER_SOURCE.CRON,
      enqueuedBy: enqueuedBy ?? undefined,
      regionId: data.regionId,
      dataTypes: [dataType],
      depth: data.depth,
      maxReps: data.maxReps,
      maxBills: data.maxBills,
      maxDocuments: data.maxDocuments,
      resetWatermark: data.resetWatermark,
    });
    return { id, bullmqJobId, dataType, status: JOB_STATUS.QUEUED };
  }

  /** A child's last act: close its parent if it was the last open child. */
  private async settleParentOf(data: RegionSyncJobData): Promise<void> {
    if (!data.parentJobId) return;
    try {
      await this.pipelineJobService.settleParent(data.parentJobId);
    } catch (error) {
      // The next child to finish settles it, or the startup sweep's
      // `settleFinishedParents` once every child has.
      this.logger.warn(
        { parentJobId: data.parentJobId, err: (error as Error).message },
        'Could not settle the parent region-sync job',
      );
    }
  }

  /**
   * Dispatch a region-sync job to the work it actually requested (#1122).
   *
   * Boundary refresh rides this same queue as its own data type but does
   * NOT go through the plugin-driven civic `syncAll` path: a `boundaries`
   * job runs the loader, any other type runs `syncAll`. Since S2 every job
   * reaching here names exactly one type — a request mixing them (e.g.
   * `[representatives, boundaries]`) fans out into one job each — so the
   * partition below no longer meets a mixed or undefined list; it is kept
   * as written rather than narrowed, so a single-type job behaves exactly
   * as it did before.
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
