import {
  abandonChildJobs,
  inlineBatch,
  settleChildJobs,
  type ChildJobBatch,
  type ChildOutcome,
} from './child-job-batch';

/**
 * The wait loop's decisions, on a scripted batch. What BullMQ itself does —
 * events for removed jobs, collapse, retries — is in the integration spec
 * against real Redis (`__tests__/integration/child-jobs`).
 */
function scriptedBatch(script: ChildOutcome<string>[][], running = 0) {
  const pending = new Set(script.flat().map((o) => o.jobId));
  let step = 0;
  let queue: ChildOutcome<string>[] = [];
  const dropped: string[] = [];
  const batch: ChildJobBatch<unknown, string> & { dropped: string[] } = {
    dropped,
    add: async () => undefined,
    take: () => {
      const out = queue.filter((o) => pending.delete(o.jobId));
      queue = [];
      return out;
    },
    get pending() {
      return pending.size;
    },
    waitForOutcome: async () => {
      queue = script[step++] ?? [];
    },
    dropWaiting: async () => {
      // All but `running` are still waiting.
      const waiting = [...pending].slice(running);
      for (const id of waiting) {
        pending.delete(id);
        dropped.push(id);
      }
      return waiting.length;
    },
    failPending: async (reason) => {
      queue = [...pending].map((jobId) => ({ jobId, ok: false, reason }));
    },
    close: async () => undefined,
  };
  return batch;
}

const ok = (jobId: string): ChildOutcome<string> => ({
  jobId,
  ok: true,
  value: jobId,
});

describe('settleChildJobs', () => {
  it('hands over every outcome as it arrives and ends when none are pending', async () => {
    const batch = scriptedBatch([[ok('a')], [], [ok('b')]]);
    const seen: string[] = [];

    const end = await settleChildJobs(batch, {
      onOutcome: (o) => seen.push(o.jobId),
      idleTimeoutMs: 60_000,
    });

    expect(end).toBe('settled');
    expect(seen).toEqual(['a', 'b']);
  });

  it('on cancel, drops the waiting jobs and still waits for the running one', async () => {
    // `running` is first in line; `waiting` has not started.
    const batch = scriptedBatch([[], [ok('running')], [ok('waiting')]], 1);
    const seen: string[] = [];

    const end = await settleChildJobs(batch, {
      onOutcome: (o) => seen.push(o.jobId),
      isCancelled: async () => true,
      idleTimeoutMs: 60_000,
    });

    expect(end).toBe('cancelled');
    expect(batch.dropped).toEqual(['waiting']);
    expect(seen).toEqual(['running']);
  });

  it('checks cancellation once, not on every turn after it fired', async () => {
    const batch = scriptedBatch([[], [], [ok('a')]], 1);
    const isCancelled = jest.fn().mockResolvedValue(true);

    await settleChildJobs(batch, {
      onOutcome: () => undefined,
      isCancelled,
      idleTimeoutMs: 60_000,
    });

    expect(isCancelled).toHaveBeenCalledTimes(1);
  });

  it('reports every job still pending as failed after the idle timeout', async () => {
    const batch = scriptedBatch([[ok('a'), ok('b')]]);
    const seen: ChildOutcome<string>[] = [];

    const end = await settleChildJobs(batch, {
      onOutcome: (o) => seen.push(o),
      idleTimeoutMs: 0,
    });

    expect(end).toBe('timed-out');
    expect(seen).toEqual([
      expect.objectContaining({ jobId: 'a', ok: false }),
      expect.objectContaining({ jobId: 'b', ok: false }),
    ]);
  });

  it('lets an outcome handler abort the wait by throwing', async () => {
    const batch = scriptedBatch([[ok('a')], [ok('b')]]);

    await expect(
      settleChildJobs(batch, {
        onOutcome: () => {
          throw new Error('aborted');
        },
        idleTimeoutMs: 60_000,
      }),
    ).rejects.toThrow('aborted');
  });
});

describe('abandonChildJobs', () => {
  it('drops what is waiting, waits out what is running, and never throws', async () => {
    const batch = scriptedBatch([[ok('a')]], 1);
    const failing = {
      ...batch,
      dropWaiting: jest.fn().mockRejectedValue(new Error('redis down')),
    };

    await expect(abandonChildJobs(failing, 60_000)).resolves.toBeUndefined();

    const healthy = scriptedBatch([[ok('running')], [ok('waiting')]], 1);
    await abandonChildJobs(healthy, 60_000);
    expect(healthy.dropped).toEqual(['waiting']);
    expect(healthy.pending).toBe(0);
  });
});

describe('inlineBatch', () => {
  it('runs each job as it is added; a throw is a failed outcome', async () => {
    const batch = inlineBatch(async (n: number) => {
      if (n < 0) throw new Error('negative');
      return n * 2;
    });

    await batch.add(2, 'a');
    await batch.add(-1, 'b');

    expect(batch.pending).toBe(0);
    expect(batch.take()).toEqual([
      { jobId: 'a', ok: true, value: 4 },
      { jobId: 'b', ok: false, reason: 'negative' },
    ]);
    expect(batch.take()).toEqual([]);
    await expect(
      settleChildJobs(batch, { onOutcome: () => undefined, idleTimeoutMs: 1 }),
    ).resolves.toBe('settled');
  });
});
