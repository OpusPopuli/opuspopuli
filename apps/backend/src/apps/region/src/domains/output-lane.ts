import { randomUUID } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import { laneJobId } from '@opuspopuli/common';
import {
  abandonChildJobs,
  inlineBatch,
  laneIdleTimeoutMs,
  settleChildJobs,
  type ChildJobBatch,
  type ChildOutcome,
} from 'src/common/child-jobs/child-job-batch';
import type { ChildJobQueues } from 'src/common/child-jobs/child-job-queues';
import type {
  GeneratedOutputOutcome,
  OutputTarget,
} from './generated-output-key';

export type { OutputTarget } from './generated-output-key';
import type { PipelineJobService } from './pipeline-job.service';
import type { SyncPhaseTracker } from './sync-phase-logger';

/**
 * One generator's stale outputs on its GPU-lane queue: one job per row, the
 * phase waiting for every outcome. Propositions' analysis (S4) and the four
 * representatives generators (`docs/plans/representatives-phase-b.md` §4)
 * share it rather than each keeping a copy.
 */

/** How one outcome reads in the phase log and the item metric. */
export interface OutputItem {
  outcome: 'created' | 'updated' | 'skipped' | 'error';
  label: string;
  /** A bounded slug, for a skip. */
  reason?: string;
}

export interface OutputLaneSpec<T extends OutputTarget, D> {
  queueName: string;
  /** The job id's stage part, and the lane's failure streak. */
  work: string;
  targets: readonly T[];
  jobData: (target: T) => D;
  /** The job's work in this process, when the queue is off or unbound. */
  runInline: (data: D) => Promise<GeneratedOutputOutcome>;
  /** How a target is named in the log; the work and its id by default. */
  name?: (target: T) => { name: string; externalId: string };
  /** Per-outcome wording, where a type has its own. */
  items?: Partial<Record<GeneratedOutputOutcome, OutputItem>>;
}

export interface OutputLaneDeps {
  childQueues?: ChildJobQueues;
  logger: Logger;
  isCancelled: () => Promise<boolean>;
}

/** A job's report as the item it counts as. */
const ITEM: Record<GeneratedOutputOutcome, OutputItem> = {
  created: { outcome: 'created', label: 'generated (first)' },
  updated: { outcome: 'updated', label: 'regenerated' },
  unchanged: {
    outcome: 'skipped',
    label: 'skipped: already current',
    reason: 'unchanged',
  },
  skipped: {
    outcome: 'skipped',
    label: 'skipped: nothing to generate from',
    reason: 'no_input',
  },
  failed: { outcome: 'error', label: 'failed' },
};

/**
 * An operator's cancel of the parent job, read between items. A failed read
 * is "not cancelled" — logged — so a database blip does not stop a sync.
 */
export function cancellationOf(
  pipelineJobs: Pick<PipelineJobService, 'isCancelled'> | undefined,
  pipelineJobId: string | undefined,
  logger: Logger,
): () => Promise<boolean> {
  return async () => {
    if (!pipelineJobId || !pipelineJobs) return false;
    try {
      return await pipelineJobs.isCancelled(pipelineJobId);
    } catch (error) {
      logger.warn(
        `Could not read cancellation for ${pipelineJobId}: ${(error as Error).message}`,
      );
      return false;
    }
  };
}

function isOutcome(value: unknown): value is GeneratedOutputOutcome {
  return typeof value === 'string' && Object.hasOwn(ITEM, value);
}

/** The job id: deterministic when the skip key is known, one-off otherwise. */
export function outputJobId(target: OutputTarget, work: string): string {
  return target.key
    ? laneJobId(target.id, work, target.key)
    : `${work}-${randomUUID()}`;
}

/** What a lane did: outputs written, and whether it stopped early. */
export interface LaneResult {
  written: number;
  aborted: boolean;
}

/**
 * Queue every target and wait, counting each outcome on `tracker`.
 *
 * Never throws: the roster is already written, and a missing output is visible
 * on its row. A consecutive-failure abort (thrown by the tracker) stops the
 * lane, waits out what is running, and is logged.
 *
 * @returns How many outputs were written, and whether the lane stopped early
 *   — a phase whose lane aborted must not then log itself complete
 */

export async function runOutputLane<T extends OutputTarget, D>(
  deps: OutputLaneDeps,
  tracker: SyncPhaseTracker<string>,
  spec: OutputLaneSpec<T, D>,
): Promise<LaneResult> {
  if (spec.targets.length === 0) return { written: 0, aborted: false };
  const nameOf =
    spec.name ?? ((t: T) => ({ name: spec.work, externalId: t.id }));
  const targets = new Map<string, T>();
  let written = 0;
  const onOutcome = (outcome: ChildOutcome<GeneratedOutputOutcome>): void => {
    const target = targets.get(outcome.jobId);
    targets.delete(outcome.jobId);
    const named = target
      ? nameOf(target)
      : { name: spec.work, externalId: outcome.jobId };
    const result = outcomeOf(deps.logger, spec.work, named.externalId, outcome);
    if (result === 'created' || result === 'updated') written++;
    const item = spec.items?.[result] ?? ITEM[result];
    tracker.item({
      ...named,
      outcomeLabel: item.label,
      outcome: item.outcome,
      // Its own failure streak: the summaries phase runs three lanes at once.
      streak: spec.work,
      ...(item.reason && { reason: item.reason }),
    });
  };

  const idleTimeoutMs = laneIdleTimeoutMs();
  let batch: ChildJobBatch<D, GeneratedOutputOutcome>;
  try {
    batch = await openBatch(deps.childQueues, spec);
  } catch (error) {
    deps.logger.warn(
      `${spec.work}: could not open ${spec.queueName} (sync continues): ${(error as Error).message}`,
    );
    return { written: 0, aborted: true };
  }
  let aborted = false;
  try {
    for (const target of spec.targets) {
      // Before each row, not only while waiting: inline, every job runs here.
      if (await deps.isCancelled()) break;
      const jobId = outputJobId(target, spec.work);
      targets.set(jobId, target);
      await queueOne(batch, spec.jobData(target), jobId, onOutcome);
      batch.take().forEach(onOutcome);
    }
    await settleChildJobs(batch, {
      onOutcome,
      isCancelled: deps.isCancelled,
      idleTimeoutMs,
    });
  } catch (error) {
    aborted = true;
    await abandonChildJobs(batch, idleTimeoutMs);
    deps.logger.warn(
      `${spec.work} lane stopped (sync continues): ${(error as Error).message}`,
    );
  } finally {
    await batch.close();
  }
  return { written, aborted };
}

function openBatch<T extends OutputTarget, D>(
  childQueues: ChildJobQueues | undefined,
  spec: OutputLaneSpec<T, D>,
): Promise<ChildJobBatch<D, GeneratedOutputOutcome>> {
  if (childQueues?.enabled(spec.queueName)) {
    return childQueues.open(spec.queueName);
  }
  return Promise.resolve(inlineBatch(spec.runInline));
}

/** Queue one row; a failure to queue is that row's failure. */
async function queueOne<D>(
  batch: ChildJobBatch<D, GeneratedOutputOutcome>,
  data: D,
  jobId: string,
  onOutcome: (outcome: ChildOutcome<GeneratedOutputOutcome>) => void,
): Promise<void> {
  try {
    await batch.add(data, jobId);
  } catch (error) {
    onOutcome({ jobId, ok: false, reason: (error as Error).message });
  }
}

/** Anything unrecognised is a failure — a job that says nothing did not work. */
function outcomeOf(
  logger: Logger,
  work: string,
  id: string,
  outcome: ChildOutcome<GeneratedOutputOutcome>,
): GeneratedOutputOutcome {
  if (!outcome.ok) {
    logger.warn(`${work} failed for ${id}: ${outcome.reason}`);
    return 'failed';
  }
  return isOutcome(outcome.value) ? outcome.value : 'failed';
}
