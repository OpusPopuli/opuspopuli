import { ChildJobWaiter, isWaitTimeout } from './child-job-waiter';
import type { ChildJobBatch, ChildOutcome } from './child-job-batch';

/** A batch whose jobs report `value` after `ms`, or never. */
function scripted(ms: number | null, value = 'parsed') {
  const arrived: ChildOutcome<string>[] = [];
  const added: string[] = [];
  let wake: (() => void) | undefined;
  const batch: ChildJobBatch<unknown, string> = {
    add: async (_data, jobId) => {
      added.push(jobId);
      if (ms !== null) {
        setTimeout(() => {
          arrived.push({ jobId, ok: true, value });
          wake?.();
        }, ms);
      }
    },
    take: () => arrived.splice(0),
    get pending() {
      return 0;
    },
    waitForOutcome: (wait) =>
      arrived.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const t = setTimeout(resolve, wait);
            wake = () => {
              clearTimeout(t);
              resolve();
            };
          }),
    dropWaiting: async () => 0,
    failPending: async () => undefined,
    close: jest.fn(async () => undefined),
  };
  return { batch, added };
}

describe('ChildJobWaiter', () => {
  it('hands each caller its own job outcome, over one batch', async () => {
    const { batch, added } = scripted(20);
    const open = jest.fn().mockResolvedValue(batch);
    const waiter = new ChildJobWaiter(open);

    const [a, b] = await Promise.all([
      waiter.run('a', {}, 5_000),
      waiter.run('b', {}, 5_000),
    ]);

    expect([a.jobId, b.jobId]).toEqual(['a', 'b']);
    expect(a.ok && b.ok).toBe(true);
    expect(added).toEqual(['a', 'b']);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shares one outcome between callers asking for the same job', async () => {
    const { batch, added } = scripted(20);
    const waiter = new ChildJobWaiter(async () => batch);

    const [first, second] = await Promise.all([
      waiter.run('same', {}, 5_000),
      waiter.run('same', {}, 5_000),
    ]);

    expect(first).toBe(second);
    expect(added).toEqual(['same']);
  });

  it('gives up on a job that never reports, as a failed outcome', async () => {
    const { batch } = scripted(null);
    const waiter = new ChildJobWaiter(async () => batch);

    const outcome = await waiter.run('lost', {}, 100);

    expect(outcome).toEqual(
      expect.objectContaining({ jobId: 'lost', ok: false }),
    );
    expect(isWaitTimeout(outcome)).toBe(true);
  });

  it('fails a job it could not queue', async () => {
    const { batch } = scripted(20);
    const waiter = new ChildJobWaiter(async () => ({
      ...batch,
      add: async () => {
        throw new Error('redis down');
      },
    }));

    await expect(waiter.run('x', {}, 5_000)).resolves.toEqual({
      jobId: 'x',
      ok: false,
      reason: 'redis down',
    });
  });

  it('closes the batch it opened', async () => {
    const { batch } = scripted(10);
    const waiter = new ChildJobWaiter(async () => batch);
    await waiter.run('a', {}, 5_000);

    await waiter.close();

    expect(batch.close).toHaveBeenCalled();
  });

  it('opens afresh after a failed open, rather than failing every later call', async () => {
    const { batch } = scripted(10);
    const open = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(batch);
    const waiter = new ChildJobWaiter(open);

    const first = await waiter.run('a', {}, 5_000);
    const second = await waiter.run('b', {}, 5_000);

    expect(first).toEqual(expect.objectContaining({ ok: false }));
    expect(isWaitTimeout(first)).toBe(false);
    expect(second).toEqual(expect.objectContaining({ jobId: 'b', ok: true }));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('settles everyone waiting on close, and refuses new work after it', async () => {
    const { batch } = scripted(null);
    const waiter = new ChildJobWaiter(async () => batch);

    const pending = waiter.run('waiting', {}, 60_000);
    await new Promise((r) => setImmediate(r));
    await waiter.close();

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: 'waiter closed' }),
    );
    await expect(waiter.run('late', {}, 60_000)).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: 'waiter closed' }),
    );
    expect(batch.close).toHaveBeenCalledTimes(1);
  });

  it('does not hand a timed-out job’s late outcome to the next caller of that id', async () => {
    const { batch } = scripted(null);
    const arrived: ChildOutcome<string>[] = [];
    const real = batch.take;
    batch.take = () => [...arrived.splice(0), ...real()];
    let added = 0;
    const add = batch.add;
    batch.add = async (data, jobId) => {
      added++;
      // The second caller's job reports for real.
      if (added === 2) arrived.push({ jobId, ok: true, value: 'fresh' });
      return add(data, jobId);
    };
    const waiter = new ChildJobWaiter(async () => batch);

    await waiter.run('same', {}, 50); // times out
    // Its late outcome lands with no caller attached.
    arrived.push({ jobId: 'same', ok: false, reason: 'job removed' });

    await expect(waiter.run('same', {}, 5_000)).resolves.toEqual(
      expect.objectContaining({ ok: true, value: 'fresh' }),
    );
  });

  it('closes cleanly when its batch never opened', async () => {
    const waiter = new ChildJobWaiter(async () => {
      throw new Error('ECONNREFUSED');
    });
    await waiter.run('a', {}, 5_000);
    await expect(waiter.close()).resolves.toBeUndefined();
  });
});
