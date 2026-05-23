import { Logger } from "@nestjs/common";

export interface ExecutionRecord {
  id: string;
}

export type ExecutionStatus = "running" | "completed" | "failed";

export interface ExecutionTrackerRepository {
  findExecution(
    pipelineJobId: string,
    sourceUrl: string,
  ): Promise<ExecutionRecord | null>;

  createExecution(args: {
    pipelineJobId: string;
    regionId: string;
    sourceUrl: string;
    dataType: string;
  }): Promise<ExecutionRecord>;

  updateExecutionStatus(id: string, status: ExecutionStatus): Promise<void>;

  findAppliedBatches(executionId: string): Promise<{ batchIndex: number }[]>;

  /** Insert a batch row. Throws with code "P2002" on UNIQUE conflict. */
  createBatch(
    executionId: string,
    batchIndex: number,
    itemCount: number,
  ): Promise<void>;

  finalizeExecution(
    id: string,
    success: boolean,
    stats: {
      itemsExtracted: number;
      itemsFailed: number;
      extractionTimeMs: number;
    },
  ): Promise<void>;
}

export interface ExecutionStats {
  itemsExtracted: number;
  itemsFailed: number;
  extractionTimeMs: number;
}

export const EXECUTION_TRACKER_REPOSITORY = "EXECUTION_TRACKER_REPOSITORY";

/**
 * Per-source execution context returned from beginSession. Handlers call
 * recordBatch/finalize without re-checking null state — disabled sessions
 * are silent no-ops with an empty appliedBatches set.
 */
export interface ExecutionSession {
  readonly appliedBatches: ReadonlySet<number>;
  recordBatch(batchIndex: number, itemCount: number): Promise<void>;
  finalize(success: boolean, stats: ExecutionStats): Promise<void>;
}

const NO_OP_SESSION: ExecutionSession = {
  appliedBatches: new Set(),
  async recordBatch() {},
  async finalize() {},
};

export class ExecutionTrackerService {
  private readonly logger = new Logger(ExecutionTrackerService.name);

  constructor(private readonly repository: ExecutionTrackerRepository | null) {}

  get isEnabled(): boolean {
    return this.repository !== null;
  }

  /**
   * Open a tracking session for one (job, source) pair. Returns a no-op
   * session when tracker is unavailable, disabled, or pipelineJobId is
   * missing — handlers can call recordBatch/finalize unconditionally.
   */
  static async beginSession(
    tracker: ExecutionTrackerService | null | undefined,
    pipelineJobId: string | undefined,
    args: { regionId: string; sourceUrl: string; dataType: string },
  ): Promise<ExecutionSession> {
    if (!pipelineJobId || !tracker?.isEnabled) return NO_OP_SESSION;

    const { executionId, appliedBatches } = await tracker.startExecution({
      pipelineJobId,
      ...args,
    });

    return {
      appliedBatches,
      recordBatch: (batchIndex, itemCount) =>
        tracker.recordBatch(executionId, batchIndex, itemCount).then(() => {}),
      finalize: (success, stats) =>
        tracker.finalizeExecution(executionId, success, stats).catch((err) => {
          tracker.logger.warn(
            `Failed to finalize execution ${executionId}: ${(err as Error).message}`,
          );
        }),
    };
  }

  /**
   * Find or create a pipeline_executions row for this (job, source) pair.
   * Idempotent — safe to call on retry; returns the same executionId and
   * the set of batch indexes already applied in a prior run.
   */
  async startExecution(args: {
    pipelineJobId: string;
    regionId: string;
    sourceUrl: string;
    dataType: string;
  }): Promise<{ executionId: string; appliedBatches: Set<number> }> {
    const { pipelineJobId, regionId, sourceUrl, dataType } = args;
    const repo = this.repository!;

    const existing = await repo.findExecution(pipelineJobId, sourceUrl);

    let executionId: string;

    if (existing) {
      executionId = existing.id;
      await repo.updateExecutionStatus(executionId, "running");
      this.logger.debug(
        `Resuming execution ${executionId} for ${regionId}/${dataType}`,
      );
    } else {
      try {
        const created = await repo.createExecution({
          pipelineJobId,
          regionId,
          sourceUrl,
          dataType,
        });
        executionId = created.id;
        this.logger.debug(
          `Started execution ${executionId} for ${regionId}/${dataType}`,
        );
      } catch (err: unknown) {
        // Two concurrent retries of the same job raced to createExecution.
        // The unique index on (pipeline_job_id, source_url) rejects the
        // second insert — re-fetch to get the winner's row.
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          const raced = await repo.findExecution(pipelineJobId, sourceUrl);
          if (!raced) throw err;
          executionId = raced.id;
          await repo.updateExecutionStatus(executionId, "running");
          this.logger.debug(
            `Race resolved — resuming execution ${executionId} for ${regionId}/${dataType}`,
          );
        } else {
          throw err;
        }
      }
    }

    const appliedRows = await repo.findAppliedBatches(executionId);

    return {
      executionId,
      appliedBatches: new Set(appliedRows.map((r) => r.batchIndex)),
    };
  }

  /**
   * Record a successfully applied batch. Called AFTER onBatch completes.
   * Returns true if new, false if the batch was already recorded in a prior
   * run (UNIQUE conflict) — caller treats as a no-op.
   */
  async recordBatch(
    executionId: string,
    batchIndex: number,
    itemCount: number,
  ): Promise<boolean> {
    try {
      await this.repository!.createBatch(executionId, batchIndex, itemCount);
      return true;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Update the pipeline_executions row with final counts and status.
   * Called once after all batches complete or on handler error.
   */
  async finalizeExecution(
    executionId: string,
    success: boolean,
    stats: ExecutionStats,
  ): Promise<void> {
    await this.repository!.finalizeExecution(executionId, success, stats);
  }
}
