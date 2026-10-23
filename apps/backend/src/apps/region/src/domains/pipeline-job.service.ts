import { Injectable } from '@nestjs/common';
import { hostname } from 'node:os';
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
  /** S2: the fanned-out request this is one data type of. */
  parentJobId?: string;
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
 * Which host this worker is, for `worker_host` (S2, §7 H1): `WORKER_HOST`,
 * or the hostname when it is unset.
 */
export function workerHost(): string {
  return configuredWorkerHost() ?? hostname();
}

/**
 * `WORKER_HOST` when a deployment set one — the only identity the startup
 * sweep scopes by. The hostname is not enough: a container's is its id and
 * changes on every recreate, so a restarted worker would never recognise the
 * rows its predecessor abandoned, and they would stay `running` for ever.
 * Unset, the sweep keeps its pre-S2 behaviour (every host's rows), which is
 * right for one host. Must be unique per worker PROCESS: two sharing one
 * would sweep each other's live rows.
 */
export function configuredWorkerHost(): string | undefined {
  return process.env.WORKER_HOST?.trim() || undefined;
}

/** A child's terminal statuses decide its parent's (S2). */
const OPEN = [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING];

/** A closed request's outcome from its children's (S2): failure outranks cancel. */
function settledOutcome(
  failed: string[],
  cancelled: string[],
): { status: string; errorMessage: string | null } {
  if (failed.length > 0) {
    return {
      status: JOB_STATUS.FAILED,
      errorMessage: `Failed: ${failed.join(', ')}`,
    };
  }
  if (cancelled.length > 0) {
    return {
      status: JOB_STATUS.CANCELLED,
      errorMessage: `Cancelled: ${cancelled.join(', ')}`,
    };
  }
  return { status: JOB_STATUS.SUCCEEDED, errorMessage: null };
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

@Injectable()
export class PipelineJobService {
  constructor(private readonly prisma: DbService) {}

  async create(input: CreatePipelineJobInput): Promise<{ id: string }> {
    return this.prisma.pipelineJob.create({
      data: {
        ...(input.id && { id: input.id }),
        ...(input.parentJobId && { parentJobId: input.parentJobId }),
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
    // Nor CANCELLED (S2): a cancel that landed after the job's own check
    // must not be overwritten back to running. FAILED may reopen — that is
    // a swept row whose redelivered job is running after all.
    await this.prisma.pipelineJob.updateMany({
      where: {
        id,
        status: { notIn: [JOB_STATUS.SUCCEEDED, JOB_STATUS.CANCELLED] },
      },
      data: {
        status: JOB_STATUS.RUNNING,
        bullmqJobId,
        startedAt: new Date(),
        attempts: { increment: 1 },
        workerHost: workerHost(),
      },
    });
  }

  /**
   * Mark a fanned-out request running (S2) — from QUEUED, RUNNING or FAILED
   * (a parent the sweep failed before it fanned out; its redelivery must
   * fan out, or the request is lost). Null when it succeeded or was
   * cancelled since its cancellation check: those fan out nothing more. A
   * redelivered parent that settled FAILED reopens harmlessly — its
   * children are all closed, so nothing is enqueued and the closing settle
   * restores it.
   */
  async markParentRunning(
    id: string,
    bullmqJobId: string,
  ): Promise<{ enqueuedBy: string | null } | null> {
    const { count } = await this.prisma.pipelineJob.updateMany({
      where: { id, status: { in: [...OPEN, JOB_STATUS.FAILED] } },
      data: {
        status: JOB_STATUS.RUNNING,
        bullmqJobId,
        startedAt: new Date(),
        attempts: { increment: 1 },
        workerHost: workerHost(),
      },
    });
    if (count === 0) return null;
    return this.prisma.pipelineJob.findUniqueOrThrow({
      where: { id },
      select: { enqueuedBy: true },
    });
  }

  // markSucceeded / markFailed leave a CANCELLED row cancelled (S2): a
  // running job cancelled mid-run finishes its current item and then ends —
  // it did not succeed at what was asked, and its parent already says so.
  async markSucceeded(id: string, results: SyncResultModel[]): Promise<void> {
    const now = new Date();
    await this.prisma.pipelineJob.updateMany({
      where: { id, status: { not: JOB_STATUS.CANCELLED } },
      data: {
        status: JOB_STATUS.SUCCEEDED,
        finishedAt: now,
        result: results as object[],
      },
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.pipelineJob.updateMany({
      where: { id, status: { not: JOB_STATUS.CANCELLED } },
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
   *
   * Scoped (S2, §7 H1) when `WORKER_HOST` is set: only rows this host ran,
   * or rows written before `worker_host` existed, so a worker starting up
   * never fails a job another host is still running. Unset, every host's
   * rows, as before (see `configuredWorkerHost`). Never a parent: a
   * fanned-out request stays `running` for as long as its longest child,
   * legitimately. A swept child settles its parent.
   */
  async sweepStaleRunning(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const host = configuredWorkerHost();
    const stale = await this.prisma.pipelineJob.findMany({
      where: {
        status: JOB_STATUS.RUNNING,
        startedAt: { lt: cutoff },
        ...(host && { OR: [{ workerHost: host }, { workerHost: null }] }),
        children: { none: {} },
      },
      select: { id: true, parentJobId: true },
    });
    if (stale.length === 0) return 0;
    const result = await this.prisma.pipelineJob.updateMany({
      // Re-checked: a row that finished since the read keeps its outcome.
      where: {
        id: { in: stale.map((r) => r.id) },
        status: JOB_STATUS.RUNNING,
      },
      data: {
        status: JOB_STATUS.FAILED,
        finishedAt: new Date(),
        errorMessage:
          'Abandoned: worker startup detected stale RUNNING row past lock-renewal window',
      },
    });
    const parents = new Set(
      stale.flatMap((r) => (r.parentJobId ? [r.parentJobId] : [])),
    );
    for (const parent of parents) await this.settleParent(parent);
    return result.count;
  }

  /**
   * Close every still-running request whose children have all finished (S2)
   * — a last child whose own settle failed leaves its parent `running`, and
   * nothing else would ever close it. Run at startup beside the sweep.
   *
   * @returns How many it closed
   */
  async settleFinishedParents(): Promise<number> {
    const parents = await this.prisma.pipelineJob.findMany({
      where: {
        status: JOB_STATUS.RUNNING,
        children: { some: {}, none: { status: { in: [...OPEN] } } },
      },
      select: { id: true },
    });
    for (const { id } of parents) await this.settleParent(id);
    return parents.length;
  }

  /**
   * Close a fanned-out request once every child has finished (S2).
   *
   * Its `results` are its children's, concatenated; it FAILED if any child
   * failed, was CANCELLED if any was (and none failed), and SUCCEEDED
   * otherwise. Does nothing while a child is still open.
   *
   * Recomputed whenever every child is closed, not only while the parent is
   * open: a child the startup sweep failed can be redelivered and succeed,
   * and the parent closed FAILED on the sweep must follow it. Written every
   * time — results, finish time and message included, so a parent a failed
   * fan-out closed early still gets its children's results — and
   * idempotently: two children finishing at once write the same thing. A
   * parent cancelled outright stays cancelled.
   *
   * @returns Whether it is closed — false while a child is still open
   */
  async settleParent(parentJobId: string): Promise<boolean> {
    const children = await this.prisma.pipelineJob.findMany({
      where: { parentJobId },
      select: {
        status: true,
        dataTypes: true,
        result: true,
        finishedAt: true,
      },
      orderBy: { enqueuedAt: 'asc' },
    });
    if (
      children.length === 0 ||
      children.some((c) => OPEN.includes(c.status as (typeof OPEN)[number]))
    ) {
      return false;
    }
    const typesWith = (status: string) =>
      children.filter((c) => c.status === status).flatMap((c) => c.dataTypes);
    const { status, errorMessage } = settledOutcome(
      typesWith(JOB_STATUS.FAILED),
      typesWith(JOB_STATUS.CANCELLED),
    );
    const finished = children.flatMap((c) =>
      c.finishedAt ? [c.finishedAt.getTime()] : [],
    );
    const result = await this.prisma.pipelineJob.updateMany({
      where: {
        id: parentJobId,
        status: { not: JOB_STATUS.CANCELLED },
      },
      data: {
        status,
        errorMessage,
        finishedAt: new Date(
          finished.length ? Math.max(...finished) : Date.now(),
        ),
        result: children.flatMap((c) =>
          Array.isArray(c.result) ? (c.result as object[]) : [],
        ),
      },
    });
    return result.count > 0;
  }

  /** A fanned-out request's child for one data type, if it exists (S2). */
  async findChild(
    parentJobId: string,
    dataType: string,
  ): Promise<{ id: string; bullmqJobId: string; status: string } | null> {
    return this.prisma.pipelineJob.findFirst({
      where: { parentJobId, dataTypes: { has: dataType } },
      select: { id: true, bullmqJobId: true, status: true },
    });
  }

  /**
   * Fail the children a fan-out created but never enqueued (S2) — when it
   * gave up part-way, they would otherwise wait `queued` for a job that does
   * not exist. Only those ids: a sibling it did enqueue is still waiting for
   * a slot, and is not failed.
   */
  async failChildren(ids: string[], errorMessage: string): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pipelineJob.updateMany({
      where: { id: { in: ids }, status: JOB_STATUS.QUEUED },
      data: { status: JOB_STATUS.FAILED, finishedAt: new Date(), errorMessage },
    });
  }

  /**
   * The row a delivery of `bullmqJobId` already created, for a job that
   * carries no row id (a cron firing): its redelivery must not create — and
   * fan out — a second request.
   */
  async findByBullmqJobId(
    bullmqJobId: string,
    enqueuedSince: Date,
  ): Promise<{ id: string } | null> {
    // Bounded by when this job was queued: a deterministic id reused for a
    // later job (once BullMQ has evicted the old one) must not match the
    // old job's closed row.
    return this.prisma.pipelineJob.findFirst({
      where: {
        bullmqJobId,
        parentJobId: null,
        enqueuedAt: { gte: enqueuedSince },
      },
      select: { id: true },
      orderBy: { enqueuedAt: 'desc' },
    });
  }

  /**
   * Cancel a request's open children (S2), returning their queue job ids so
   * the caller can drop any still waiting.
   */
  async cancelChildren(parentJobId: string, reason: string): Promise<string[]> {
    const open = await this.prisma.pipelineJob.findMany({
      where: { parentJobId, status: { in: [...OPEN] } },
      select: { id: true, bullmqJobId: true },
    });
    if (open.length === 0) return [];
    await this.prisma.pipelineJob.updateMany({
      where: { id: { in: open.map((c) => c.id) }, status: { in: [...OPEN] } },
      data: {
        status: JOB_STATUS.CANCELLED,
        finishedAt: new Date(),
        errorMessage: `Cancelled: ${reason}`,
      },
    });
    return open.map((c) => c.bullmqJobId);
  }

  /**
   * A row's queue job id and the request it was fanned out from (S2). The
   * queue id is not always the row id — a child's is `<parent>-<type>`, a
   * startup job's `startup-<date>` — so removing a job by row id misses it.
   */
  async findQueueLink(
    id: string,
  ): Promise<{ bullmqJobId: string; parentJobId: string | null } | null> {
    return this.prisma.pipelineJob.findUnique({
      where: { id },
      select: { bullmqJobId: true, parentJobId: true },
    });
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
      select: { status: true, parent: { select: { status: true } } },
    });
    // A child created just after its parent was cancelled escaped the
    // cancel's fan-out; it reads its parent's state too (S2).
    return (
      row?.status === JOB_STATUS.CANCELLED ||
      row?.parent?.status === JOB_STATUS.CANCELLED
    );
  }

  async findById(id: string): Promise<RegionSyncJobModel | null> {
    const row = await this.prisma.pipelineJob.findUnique({ where: { id } });
    return row ? this.toModel(row) : null;
  }

  async findRecent(limit: number): Promise<RegionSyncJobModel[]> {
    // Top-level only (S2, owner decision): one line per request, its
    // children rolled up into it by `settleParent`.
    const rows = await this.prisma.pipelineJob.findMany({
      where: { parentJobId: null },
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
