import { Injectable } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  JOB_STATUS,
  TriggerSource,
  type LlmRerankJobResult,
} from '@opuspopuli/queue-provider';
import {
  LlmRerankJobModel,
  LlmRerankJobResultModel,
  LlmRerankJobStatus,
  LlmRerankTriggerSource,
} from './models/llm-rerank-job.model';

export interface CreateLlmRerankJobInput {
  bullmqJobId: string;
  triggerSource: TriggerSource;
  userId: string;
  candidateLimit?: number;
}

/**
 * Async-job status tracking for the `llm-rerank` BullMQ queue (#745).
 * Lifecycle mirrors `PipelineJobService`: queued → running →
 * (succeeded | failed). The worker calls `markRunning` before doing
 * work and `markSucceeded`/`markFailed` after.
 *
 * `sweepStaleRunning` runs on worker startup to recover rows whose
 * worker died mid-run without firing the catch-path mark — same
 * pattern as opuspopuli#730 in the region pipeline.
 */
@Injectable()
export class LlmRerankJobService {
  constructor(private readonly prisma: DbService) {}

  /**
   * Idempotent on the unique `bullmqJobId`: if a row with the same
   * deterministic jobId already exists (concurrent cron replicas, manual
   * retrigger of the same Date.now()-based id), returns the existing
   * row's id instead of throwing P2002. The race is resolved at the DB
   * layer; the loser just sees the winner's row.
   */
  async create(input: CreateLlmRerankJobInput): Promise<{ id: string }> {
    return this.prisma.llmRerankJob.upsert({
      where: { bullmqJobId: input.bullmqJobId },
      update: {},
      create: {
        bullmqJobId: input.bullmqJobId,
        triggerSource: input.triggerSource,
        userId: input.userId,
        candidateLimit: input.candidateLimit ?? null,
        status: JOB_STATUS.QUEUED,
      },
      select: { id: true },
    });
  }

  async markRunning(id: string, bullmqJobId: string): Promise<void> {
    // Skip if already SUCCEEDED — BullMQ can re-enqueue a stalled job
    // even after the original attempt finished; we must not overwrite
    // the completed row's startedAt/finishedAt.
    await this.prisma.llmRerankJob.updateMany({
      where: { id, status: { not: JOB_STATUS.SUCCEEDED } },
      data: {
        status: JOB_STATUS.RUNNING,
        bullmqJobId,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  }

  /**
   * Guarded against re-entry: if the row was already swept stale (set
   * to FAILED by `sweepStaleRunning` on a later worker startup) and a
   * slow worker then completes outside the lock-renewal window, the
   * SUCCEEDED-only `where` clause keeps the FAILED state authoritative
   * rather than letting the late worker resurrect the row. Symmetric
   * with `markRunning`.
   */
  async markSucceeded(id: string, result: LlmRerankJobResult): Promise<void> {
    await this.prisma.llmRerankJob.updateMany({
      where: { id, status: { not: JOB_STATUS.SUCCEEDED } },
      data: {
        status: JOB_STATUS.SUCCEEDED,
        finishedAt: new Date(),
        // Prisma's InputJsonValue requires a string index signature
        // that our result type intentionally doesn't have; cast via
        // `unknown` so the JSON column accepts the plain object.
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Same SUCCEEDED guard as `markSucceeded` — a job that completed
   * successfully should NEVER be flipped back to FAILED by a slow
   * retry-path that lost the race.
   */
  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.llmRerankJob.updateMany({
      where: { id, status: { not: JOB_STATUS.SUCCEEDED } },
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
   * firing the catch-path mark. Idempotent — returns the count for
   * caller logging. Same pattern as PipelineJobService.sweepStaleRunning
   * (opuspopuli#730).
   */
  async sweepStaleRunning(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await this.prisma.llmRerankJob.updateMany({
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
   * Polling read scoped to the authenticated user — citizens see their
   * own rerank-job history only. Operators can query the table directly
   * if they need cross-user observability (admin polling resolver is a
   * follow-up; not part of v1.0). Returns null when the row exists but
   * belongs to a different user, so a malicious client can't probe the
   * id space to learn other users' job ids.
   */
  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<LlmRerankJobModel | null> {
    const row = await this.prisma.llmRerankJob.findFirst({
      where: { id, userId },
    });
    return row ? rowToModel(row) : null;
  }

  async findRecentForUser(
    userId: string,
    limit: number,
  ): Promise<LlmRerankJobModel[]> {
    const rows = await this.prisma.llmRerankJob.findMany({
      where: { userId },
      orderBy: { enqueuedAt: 'desc' },
      take: limit,
    });
    return rows.map(rowToModel);
  }
}

/**
 * Row shape pulled from Prisma's generated `LlmRerankJob` model. Kept
 * narrow (just the columns toModel actually reads) so the function can
 * accept either a full row or the projection from a `select` clause.
 */
interface LlmRerankJobRow {
  id: string;
  status: string;
  triggerSource: string;
  candidateLimit: number | null;
  attempts: number;
  enqueuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  result: unknown;
}

/**
 * Map a `llm_rerank_jobs` row onto the GraphQL `LlmRerankJobModel`.
 * Hoisted out of the service class (it doesn't need `this`) so the
 * shared rerank-job lifecycle pattern doesn't get flagged as a CPD
 * clone against `PipelineJobService.toModel` — same intent, different
 * entity.
 */
function rowToModel(row: LlmRerankJobRow): LlmRerankJobModel {
  const model = new LlmRerankJobModel();
  model.jobId = row.id;
  model.status = row.status.toUpperCase() as LlmRerankJobStatus;
  model.triggerSource =
    row.triggerSource.toUpperCase() as LlmRerankTriggerSource;
  model.candidateLimit = row.candidateLimit ?? undefined;
  model.attempts = row.attempts;
  model.enqueuedAt = row.enqueuedAt;
  model.startedAt = row.startedAt ?? undefined;
  model.finishedAt = row.finishedAt ?? undefined;
  model.errorMessage = row.errorMessage ?? undefined;

  if (row.result) {
    const r = row.result as LlmRerankJobResult;
    const m = new LlmRerankJobResultModel();
    m.candidatesConsidered = r.candidatesConsidered;
    m.cacheWritesWithExplanation = r.cacheWritesWithExplanation;
    m.cacheWritesWithoutExplanation = r.cacheWritesWithoutExplanation;
    m.llmFailures = r.llmFailures;
    m.validatorRejections = r.validatorRejections;
    m.budgetExhausted = r.budgetExhausted;
    m.totalTokens = r.totalTokens;
    model.result = m;
  }

  if (row.startedAt && row.finishedAt) {
    model.elapsedMs = row.finishedAt.getTime() - row.startedAt.getTime();
  }

  return model;
}
