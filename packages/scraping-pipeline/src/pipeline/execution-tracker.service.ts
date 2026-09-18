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

  /**
   * `pipelineJobId` is optional: a cron-triggered sync has no job row, and an
   * execution without one is still a real run worth recording. The unique
   * index on (pipeline_job_id, source_url) is partial —
   * `WHERE pipeline_job_id IS NOT NULL` — so job-less rows are unconstrained
   * by design and need no migration.
   */
  createExecution(args: {
    pipelineJobId?: string | null;
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

/** Logger for the static session path, where no tracker instance may exist. */
const sessionLogger = new Logger("ExecutionSession");

/**
 * Per-source execution context returned from beginSession. Handlers call
 * recordBatch/finalize without re-checking null state — disabled sessions
 * are silent no-ops with an empty appliedBatches set.
 */
export interface ExecutionSession {
  /**
   * The run this session records, or null when tracking is unavailable.
   *
   * Exposed so rows and archived sources can point back at the run that
   * produced them (#1280, #1276) — the reason the linkage was impossible
   * before is that this id never left the tracker.
   */
  readonly executionId: string | null;
  readonly appliedBatches: ReadonlySet<number>;
  recordBatch(batchIndex: number, itemCount: number): Promise<void>;
  finalize(success: boolean, stats: ExecutionStats): Promise<void>;
}

const NO_OP_SESSION: ExecutionSession = {
  executionId: null,
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
    if (!tracker?.isEnabled) {
      // Say so. This used to return silently, and a run that recorded nothing
      // was indistinguishable from a healthy one — which is how every data
      // type but campaign finance ended up with zero executions on record
      // (#1280).
      sessionLogger.warn(
        `Execution tracking unavailable — run for ${args.regionId}/${args.dataType} ` +
          `(${args.sourceUrl}) will not be recorded and its rows cannot be traced to it`,
      );
      return NO_OP_SESSION;
    }

    // A missing pipelineJobId used to mean "record nothing", which silently
    // excluded every cron-triggered sync. A job-less run is still a real run:
    // it is recorded, it just cannot be resumed, because resume keys on
    // (job, source).
    const { executionId, appliedBatches } = await tracker.startExecution({
      pipelineJobId: pipelineJobId ?? null,
      ...args,
    });

    return {
      executionId,
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
    pipelineJobId?: string | null;
    regionId: string;
    sourceUrl: string;
    dataType: string;
  }): Promise<{ executionId: string; appliedBatches: Set<number> }> {
    const { pipelineJobId, regionId, sourceUrl, dataType } = args;
    const repo = this.repository!;

    // Without a job there is nothing to resume: the idempotency key is
    // (job, source), and the unique index that enforces it is partial on
    // `pipeline_job_id IS NOT NULL`. Record a fresh run and move on.
    if (!pipelineJobId) {
      const created = await repo.createExecution({
        pipelineJobId: null,
        regionId,
        sourceUrl,
        dataType,
      });
      this.logger.debug(
        `Started job-less execution ${created.id} for ${regionId}/${dataType}`,
      );
      return { executionId: created.id, appliedBatches: new Set() };
    }

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
