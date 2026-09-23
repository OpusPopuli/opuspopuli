import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { JOB_STATUS, TriggerSource } from '@opuspopuli/queue-provider';
import {
  RegionSyncJobModel,
  SyncJobStatus,
  SyncTriggerSource,
} from './models/pipeline-job.model';
import { DataTypeGQL, SyncResultModel } from './models/region-info.model';

export interface CreatePipelineJobInput {
  id?: string;
  bullmqJobId: string;
  triggerSource: TriggerSource;
  enqueuedBy?: string;
  regionId?: string;
  dataTypes?: string[];
  depth?: string;
  maxReps?: number;
  maxBills?: number;
  maxDocuments?: number;
  resetWatermark?: boolean;
}

/**
 * Map a stored string onto a GraphQL enum, failing loudly if it does not fit.
 *
 * The previous `row.status.toUpperCase() as SyncJobStatus` typechecked for ANY
 * string, so adding a new status to the database without adding it here was
 * invisible until read time — and then failed GraphQL serialization on a
 * non-nullable field, taking the whole query with it.
 *
 * That is exactly what happened with `cancelled`: the write path gained a
 * status the read model did not know, which would have broken the
 * `regionSyncJob` query an operator uses to confirm a cancel took effect.
 * Caught by the pre-push review gate rather than by the type system, because
 * the cast silenced the type system.
 *
 * Throws rather than defaulting: a job whose status we cannot name is not a
 * job we should describe with a plausible-looking guess.
 */
function toEnum<T extends Record<string, string>>(
  value: string,
  members: T,
  name: string,
): T[keyof T] {
  const upper = value.toUpperCase();
  if (!Object.values(members).includes(upper)) {
    throw new Error(
      `${name} has no member for the stored value "${value}". A status was ` +
        `added to the database without adding it to the GraphQL enum.`,
    );
  }
  return upper as T[keyof T];
}

@Injectable()@Injectable()
export class PipelineJobService {
  constructor(private readonly prisma: DbService) {}

  async create(input: CreatePipelineJobInput): Promise<{ id: string }> {
    return this.prisma.pipelineJob.create({
      data: {
        ...(input.id && { id: input.id }),
        bullmqJobId: input.bullmqJobId,
        triggerSource: input.triggerSource,
        enqueuedBy: input.enqueuedBy ?? null,
        regionId: input.regionId ?? null,
        dataTypes: input.dataTypes ?? [],
        depth: input.depth ?? null,
        maxReps: input.maxReps ?? null,
        maxBills: input.maxBills ?? null,
        maxDocuments: input.maxDocuments ?? null,
        resetWatermark: input.resetWatermark ?? null,
        status: JOB_STATUS.QUEUED,
      },
      select: { id: true },
    });
  }

  async markRunning(id: string, bullmqJobId: string): Promise<void> {
    // Skip if already SUCCEEDED — BullMQ can re-enqueue a stalled job even
    // after the original attempt finished, and we must not overwrite the
    // completed record's startedAt/finishedAt (which would cause negative elapsedMs).
    await this.prisma.pipelineJob.updateMany({
      where: { id, status: { not: JOB_STATUS.SUCCEEDED } },
      data: {
        status: JOB_STATUS.RUNNING,
        bullmqJobId,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  }

  async markSucceeded(id: string, results: SyncResultModel[]): Promise<void> {
    const now = new Date();
    await this.prisma.pipelineJob.update({
      where: { id },
      data: {
        status: JOB_STATUS.SUCCEEDED,
        finishedAt: now,
        result: results as object[],
      },
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.pipelineJob.update({
      where: { id },
      data: {
        status: JOB_STATUS.FAILED,
        finishedAt: new Date(),
        errorMessage,
      },
    });
  }

  /**
   * Mark any rows stuck in RUNNING for longer than `maxAgeMs` as FAILED.
   * Called on worker startup to recover rows whose worker died without
   * firing the catch-path mark (e.g. BullMQ stall + worker crash).
   *
   * Idempotent: if no rows match, returns 0 with no DB writes. Returns
   * the count for caller logging. See opuspopuli#730.
   */
  async sweepStaleRunning(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await this.prisma.pipelineJob.updateMany({
      where: {
        status: JOB_STATUS.RUNNING,
        startedAt: { lt: cutoff },
      },
      data: {
        status: JOB_STATUS.FAILED,
        finishedAt: new Date(),
        errorMessage:
          'Abandoned: worker startup detected stale RUNNING row past lock-renewal window',
      },
    });
    return result.count;
  }

  /**
   * Mark a job cancelled so it stops — and, crucially, stays stopped.
   *
   * Only `queued` or `running` rows can be cancelled; anything finished is
   * left alone, so a late click cannot rewrite history.
   *
   * `cancelled` is a new status string rather than an enum value: `status` is
   * a plain String column, so this needs no migration and no coordinated
   * deploy. `sweepStaleRunning` only touches `running`, so a cancelled row is
   * never resurrected by the startup sweeper either.
   *
   * @param id - The pipeline_jobs row
   * @param reason - Recorded on the row, so the stop is explained rather than
   *   merely recorded
   * @returns Whether this call was the one that cancelled it
   */
  async cancel(id: string, reason: string): Promise<boolean> {
    const result = await this.prisma.pipelineJob.updateMany({
      where: {
        id,
        status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] },
      },
      data: {
        status: JOB_STATUS.CANCELLED,
        finishedAt: new Date(),
        errorMessage: `Cancelled: ${reason}`,
      },
    });
    return result.count > 0;
  }

  /**
   * Has this job been cancelled?
   *
   * Read at the job boundary by the processor. BullMQ re-delivers a stalled
   * job when a worker restarts, so without this a cancelled job begins again
   * from item 1 every time the worker comes up — which on 2026-09-22 left
   * hand-editing Redis as the only way out.
   */
  async isCancelled(id: string): Promise<boolean> {
    const row = await this.prisma.pipelineJob.findUnique({
      where: { id },
      select: { status: true },
    });
    return row?.status === JOB_STATUS.CANCELLED;
  }

  async findById(id: string): Promise<RegionSyncJobModel | null> {
    const row = await this.prisma.pipelineJob.findUnique({ where: { id } });
    return row ? this.toModel(row) : null;
  }

  async findRecent(limit: number): Promise<RegionSyncJobModel[]> {
    const rows = await this.prisma.pipelineJob.findMany({
      orderBy: { enqueuedAt: 'desc' },
      take: limit,
    });
    return rows.map((r: Parameters<typeof this.toModel>[0]) => this.toModel(r));
  }

  private toModel(row: {
    id: string;
    status: string;
    triggerSource: string;
    regionId: string | null;
    dataTypes: string[];
    enqueuedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorMessage: string | null;
    result: unknown;
  }): RegionSyncJobModel {
    const model = new RegionSyncJobModel();
    model.jobId = row.id;
    model.status = toEnum(row.status, SyncJobStatus, 'SyncJobStatus');
    model.triggerSource = toEnum(
      row.triggerSource,
      SyncTriggerSource,
      'SyncTriggerSource',
    );
    model.regionId = row.regionId ?? undefined;
    model.dataTypes = row.dataTypes;
    model.enqueuedAt = row.enqueuedAt;
    model.startedAt = row.startedAt ?? undefined;
    model.finishedAt = row.finishedAt ?? undefined;
    model.errorMessage = row.errorMessage ?? undefined;

    if (row.result) {
      model.results = (row.result as SyncResultModel[]).map((r) => ({
        ...r,
        dataType: r.dataType as DataTypeGQL,
      }));
    }

    if (row.startedAt && row.finishedAt) {
      model.elapsedMs = row.finishedAt.getTime() - row.startedAt.getTime();
    }

    return model;
  }
}
