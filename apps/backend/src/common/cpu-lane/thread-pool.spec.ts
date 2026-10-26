import { join } from 'node:path';
import { ThreadPool } from './thread-pool';

const FILE = join(__dirname, 'test-fixtures', 'scripted.thread.js');

describe('ThreadPool (the S6 CPU lane engine)', () => {
  let pool: ThreadPool<
    Record<string, unknown>,
    { value?: unknown; length?: number; startedAt?: number }
  >;

  const make = (size: number, timeoutMs = 5_000) =>
    (pool = new ThreadPool({
      file: FILE,
      size,
      timeoutMs,
      maxOldGenerationMb: 64,
    }));

  afterEach(async () => {
    await pool?.close();
  });

  it('runs tasks in parallel up to its size, and answers each task its own result', async () => {
    make(3);

    const results = await Promise.all(
      [1, 2, 3].map((value) => pool.run({ op: 'echo', ms: 300, value })),
    );

    expect(results.map((r) => r.value)).toEqual([1, 2, 3]);
    // Overlap, asserted directly rather than from wall clock (which flakes
    // on a loaded runner): every task started before the first could have
    // finished.
    const starts = results.map((r) => r.startedAt as number);
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(300);
  });

  it('queues work beyond its size', async () => {
    make(1);

    const results = await Promise.all(
      [1, 2].map((value) => pool.run({ op: 'echo', ms: 50, value })),
    );

    expect(results.map((r) => r.value)).toEqual([1, 2]);
  });

  it('moves a buffer to the thread rather than copying it', async () => {
    make(1);
    const bytes = new ArrayBuffer(1024);

    const result = await pool.run({ op: 'echo', bytes }, [bytes]);

    expect(result.length).toBe(1024);
    // Transferred: the sender's view is detached.
    expect(bytes.byteLength).toBe(0);
  });

  it('rejects a task its thread reports as failed, and keeps serving', async () => {
    make(1);

    await expect(pool.run({ op: 'throw' })).rejects.toThrow('scripted failure');
    await expect(
      pool.run({ op: 'echo', value: 'after' }),
    ).resolves.toMatchObject({
      value: 'after',
    });
  });

  it('terminates and replaces a thread that hangs past the timeout', async () => {
    make(1, 300);

    await expect(pool.run({ op: 'hang' })).rejects.toThrow(
      /no result within 300ms/,
    );
    await expect(
      pool.run({ op: 'echo', value: 'fresh' }),
    ).resolves.toMatchObject({
      value: 'fresh',
    });
    expect(pool.size).toBe(1);
  });

  it('replaces a thread that dies mid-task', async () => {
    make(1);

    await expect(pool.run({ op: 'exit' })).rejects.toThrow(/exited/);
    await expect(
      pool.run({ op: 'echo', value: 'again' }),
    ).resolves.toMatchObject({
      value: 'again',
    });
  });

  it('refuses work once closed, and fails what was still queued', async () => {
    make(1);
    // Expectations attached BEFORE close, which rejects both at once.
    const running = expect(pool.run({ op: 'echo', ms: 200 })).rejects.toThrow();
    const queued = expect(pool.run({ op: 'echo' })).rejects.toThrow(/closed/);

    await pool.close();

    await running;
    await queued;
    await expect(pool.run({ op: 'echo' })).rejects.toThrow(/closed/);
  });

  it('shortens a long thread error before it reaches callers and logs', async () => {
    make(1);
    await expect(pool.run({ op: 'throw-long' })).rejects.toThrow(/^x{200}…$/);
  });

  it('stops respawning a script that cannot load, and fails work with why', async () => {
    pool = new ThreadPool({
      file: join(__dirname, 'test-fixtures', 'does-not-exist.js'),
      size: 1,
      timeoutMs: 5_000,
      maxOldGenerationMb: 64,
    });
    const first = pool.run({ op: 'echo' });
    await expect(first).rejects.toThrow();

    // Three unready deaths in a row break the pool; give them time to land.
    await new Promise((r) => setTimeout(r, 1_500));
    await expect(pool.run({ op: 'echo' })).rejects.toThrow(
      /failed to start 3 times in a row/,
    );
  });

  it('tries the script again after the cooldown, rather than staying dark', async () => {
    pool = new ThreadPool({
      file: join(__dirname, 'test-fixtures', 'does-not-exist.js'),
      size: 1,
      timeoutMs: 5_000,
      maxOldGenerationMb: 64,
    });
    await expect(pool.run({ op: 'echo' })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 1_500));
    await expect(pool.run({ op: 'echo' })).rejects.toThrow(/failed to start/);

    // The script becomes loadable (a transient spawn failure passes), and
    // the cooldown runs out.
    const internals = pool as unknown as {
      options: { file: string };
      broken?: { at: number };
    };
    internals.options.file = FILE;
    internals.broken!.at -= 5 * 60 * 1000 + 1;

    await expect(
      pool.run({ op: 'echo', value: 'back' }),
    ).resolves.toMatchObject({ value: 'back' });
  });
});
