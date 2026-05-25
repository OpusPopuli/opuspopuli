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
}

@Injectable()
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
    model.status = row.status.toUpperCase() as SyncJobStatus;
    model.triggerSource = row.triggerSource.toUpperCase() as SyncTriggerSource;
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
