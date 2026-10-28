import { Logger } from '@nestjs/common';
import type {
  ChildJobBatch,
  ChildOutcome,
} from 'src/common/child-jobs/child-job-batch';
import type { GeneratedOutputOutcome } from './generated-output-key';
import { outputJobId, runOutputLane, type OutputTarget } from './output-lane';
import { repSyncTracker } from './sync-phase-logger';

const KEY = 'a'.repeat(64);

const logger = new Logger('output-lane.spec');

const tracker = () => repSyncTracker(logger, 'summaries', 0);

const spec = (
  targets: OutputTarget[],
  runInline: jest.Mock = jest.fn().mockResolvedValue('updated'),
) => ({
  queueName: 'committee-summary',
  work: 'committee-summary',
  targets,
  jobData: (target: OutputTarget) => ({ representativeId: target.id }),
  runInline,
});

/**
 * A queue batch that reports each added job's outcome only when the test says
 * so — the shape of the real one, where outcomes arrive off an event stream.
 */
const queuedBatch = (
  outcomes: Record<string, ChildOutcome<GeneratedOutputOutcome>>,
) => {
  const pending = new Set<string>();
  const arrived: ChildOutcome<GeneratedOutputOutcome>[] = [];
  const added: { data: unknown; jobId: string }[] = [];
  const batch: ChildJobBatch<unknown, GeneratedOutputOutcome> & {
    added: typeof added;
  } = {
    added,
    async add(data, jobId) {
      added.push({ data, jobId });
      pending.add(jobId);
    },
    take: () => arrived.splice(0),
    get pending() {
      return pending.size;
    },
    async waitForOutcome() {
      for (const jobId of [...pending]) {
        pending.delete(jobId);
        arrived.push(
          outcomes[jobId] ?? { jobId, ok: false, reason: 'no outcome' },
        );
      }
    },
    dropWaiting: jest.fn().mockResolvedValue(0),
    failPending: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return batch;
};

const queues = (batch: ChildJobBatch<unknown, GeneratedOutputOutcome>) => ({
  enabled: jest.fn().mockReturnValue(true),
  open: jest.fn().mockResolvedValue(batch),
});

const deps = (overrides: Record<string, unknown> = {}) => ({
  logger,
  isCancelled: jest.fn().mockResolvedValue(false),
  ...overrides,
});

describe('outputJobId', () => {
  it('names the same output and inputs the same job — a repeat collapses onto it', () => {
    const target = { id: 'rep-1', key: KEY };

    expect(outputJobId(target, 'bio')).toBe(outputJobId(target, 'bio'));
    expect(outputJobId(target, 'bio')).toBe(`rep-1__bio__${KEY}`);
  });

  it('gives a one-off id when the skip key cannot be known', () => {
    const target = { id: 'rep-1', key: null };

    expect(outputJobId(target, 'bio')).not.toBe(outputJobId(target, 'bio'));
    expect(outputJobId(target, 'bio')).toMatch(/^bio-/);
  });
});

describe('runOutputLane', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs each job in this process when no queue is bound', async () => {
    const runInline = jest.fn().mockResolvedValue('created');

    const { written } = await runOutputLane(
      deps(),
      tracker(),
      spec(
        [
          { id: 'rep-1', key: KEY },
          { id: 'rep-2', key: null },
        ],
        runInline,
      ),
    );

    expect(runInline.mock.calls).toEqual([
      [{ representativeId: 'rep-1' }],
      [{ representativeId: 'rep-2' }],
    ]);
    expect(written).toBe(2);
  });

  it('runs in this process when the queue is switched off', async () => {
    const runInline = jest.fn().mockResolvedValue('updated');
    const childQueues = {
      enabled: jest.fn().mockReturnValue(false),
      open: jest.fn(),
    };

    await runOutputLane(
      deps({ childQueues }),
      tracker(),
      spec([{ id: 'rep-1', key: KEY }], runInline),
    );

    expect(childQueues.open).not.toHaveBeenCalled();
    expect(runInline).toHaveBeenCalledTimes(1);
  });

  it('queues one job per output and counts each outcome as it arrives', async () => {
    const jobId = `rep-1__committee-summary__${KEY}`;
    const batch = queuedBatch({
      [jobId]: { jobId, ok: true, value: 'updated' },
    });
    const phase = tracker();

    const { written } = await runOutputLane(
      deps({ childQueues: queues(batch) }),
      phase,
      spec([{ id: 'rep-1', key: KEY }]),
    );

    expect(batch.added).toEqual([
      { data: { representativeId: 'rep-1' }, jobId },
    ]);
    expect(written).toBe(1);
    expect(phase.complete()).toMatchObject({ updated: 1, errors: 0 });
    expect(batch.close).toHaveBeenCalled();
  });

  it('counts an output already current by the time it ran as skipped, not written', async () => {
    const jobId = `rep-1__committee-summary__${KEY}`;
    const batch = queuedBatch({
      [jobId]: { jobId, ok: true, value: 'unchanged' },
    });
    const phase = tracker();

    const { written } = await runOutputLane(
      deps({ childQueues: queues(batch) }),
      phase,
      spec([{ id: 'rep-1', key: KEY }]),
    );

    expect(written).toBe(0);
    expect(phase.complete()).toMatchObject({ skipped: 1, updated: 0 });
  });

  it('counts a failed job, and a job reporting nothing it knows, as failed', async () => {
    const ids = [
      `rep-1__committee-summary__${KEY}`,
      `rep-2__committee-summary__${KEY}`,
    ];
    const batch = queuedBatch({
      [ids[0]]: { jobId: ids[0], ok: false, reason: 'llm_error' },
      [ids[1]]: { jobId: ids[1], ok: true, value: 'done?' as never },
    });
    const phase = tracker();

    await runOutputLane(
      deps({ childQueues: queues(batch) }),
      phase,
      spec([
        { id: 'rep-1', key: KEY },
        { id: 'rep-2', key: KEY },
      ]),
    );

    expect(phase.complete()).toMatchObject({ errors: 2, updated: 0 });
  });

  it('counts an output that could not be queued as failed, and queues the rest', async () => {
    const jobId = `rep-2__committee-summary__${KEY}`;
    const batch = queuedBatch({
      [jobId]: { jobId, ok: true, value: 'created' },
    });
    const add = batch.add.bind(batch);
    batch.add = jest
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockImplementation(add);
    const phase = tracker();

    await runOutputLane(
      deps({ childQueues: queues(batch) }),
      phase,
      spec([
        { id: 'rep-1', key: KEY },
        { id: 'rep-2', key: KEY },
      ]),
    );

    expect(phase.complete()).toMatchObject({ errors: 1, created: 1 });
  });

  it('stops queueing on an operator cancel', async () => {
    const runInline = jest.fn().mockResolvedValue('updated');
    const isCancelled = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    await runOutputLane(
      deps({ isCancelled }),
      tracker(),
      spec(
        [
          { id: 'rep-1', key: KEY },
          { id: 'rep-2', key: KEY },
        ],
        runInline,
      ),
    );

    expect(runInline).toHaveBeenCalledTimes(1);
  });

  it('never throws when the queue cannot be opened — the roster is already written', async () => {
    const childQueues = {
      enabled: jest.fn().mockReturnValue(true),
      open: jest.fn().mockRejectedValue(new Error('redis down')),
    };

    await expect(
      runOutputLane(
        deps({ childQueues }),
        tracker(),
        spec([{ id: 'rep-1', key: KEY }]),
      ),
    ).resolves.toEqual({ written: 0, aborted: true });
  });

  it('stops on a consecutive-failure abort, and does not fail the sync', async () => {
    const runInline = jest.fn().mockRejectedValue(new Error('llm_error'));
    const targets = Array.from({ length: 20 }, (_, i) => ({
      id: `rep-${i}`,
      key: KEY,
    }));

    await expect(
      runOutputLane(deps(), tracker(), spec(targets, runInline)),
    ).resolves.toEqual({ written: 0, aborted: true });
    // The abort stopped the lane before the end of the list.
    expect(runInline.mock.calls.length).toBeLessThan(targets.length);
  });

  it('queued: an abort drops the waiting jobs and still closes the batch', async () => {
    const targets = Array.from({ length: 6 }, (_, i) => ({
      id: `rep-${i}`,
      key: KEY,
    }));
    const batch = queuedBatch(
      Object.fromEntries(
        targets.map((t) => {
          const jobId = `${t.id}__committee-summary__${KEY}`;
          return [jobId, { jobId, ok: false, reason: 'llm_error' }];
        }),
      ),
    );

    await expect(
      runOutputLane(
        deps({ childQueues: queues(batch) }),
        tracker(),
        spec(targets),
      ),
    ).resolves.toEqual({ written: 0, aborted: true });
    // abandonChildJobs → dropWaiting; the batch is closed either way.
    expect(batch.dropWaiting).toHaveBeenCalled();
    expect(batch.close).toHaveBeenCalled();
  });

  it('queued: a cancel while waiting drops the jobs that have not started', async () => {
    const jobId = `rep-1__committee-summary__${KEY}`;
    const batch = queuedBatch({
      [jobId]: { jobId, ok: true, value: 'updated' },
    });
    const isCancelled = jest
      .fn()
      .mockResolvedValueOnce(false) // before queueing rep-1
      .mockResolvedValue(true); // while waiting

    await runOutputLane(
      deps({ childQueues: queues(batch), isCancelled }),
      tracker(),
      spec([{ id: 'rep-1', key: KEY }]),
    );

    expect(batch.dropWaiting).toHaveBeenCalled();
    expect(batch.close).toHaveBeenCalled();
  });

  it('keeps each lane its own failure streak on a shared tracker', async () => {
    // Three lanes run at once in the summaries phase: one lane's failures
    // must not be cleared by another's successes.
    const phase = tracker();
    const failing = jest.fn().mockRejectedValue(new Error('llm_error'));
    const passing = jest.fn().mockResolvedValue('updated');
    const targets = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `r-${i}`, key: KEY }));

    const [a, { written }] = await Promise.all([
      runOutputLane(deps(), phase, {
        ...spec(targets(20), failing),
        work: 'a',
      }),
      runOutputLane(deps(), phase, {
        ...spec(targets(20), passing),
        work: 'b',
      }),
    ]);

    // Lane a aborted after its fifth failure; lane b finished all 20.
    expect(a.aborted).toBe(true);
    expect(failing.mock.calls.length).toBeLessThan(20);
    expect(written).toBe(20);
  });

  it('does nothing for an empty selection', async () => {
    const childQueues = { enabled: jest.fn(), open: jest.fn() };

    await runOutputLane(deps({ childQueues }), tracker(), spec([]));

    expect(childQueues.open).not.toHaveBeenCalled();
  });
});
