/**
 * Fan-out-and-await against real Redis and BullMQ (civics S3,
 * `docs/plans/civics-phase-b.md` §3).
 *
 * Every property here is about BullMQ's own behaviour, which a mock would
 * only restate: that a job finished and removed before anyone asks still
 * reports (the parent listens rather than reading the job back), that a
 * deterministic id collapses onto in-flight work but not onto finished work,
 * that a retried job reports one failure, not one per attempt.
 */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QueueService } from '@opuspopuli/queue-provider';
import {
  abandonChildJobs,
  openQueueBatch,
  settleChildJobs,
  type ChildJobBatch,
  type ChildOutcome,
} from 'src/common/child-jobs/child-job-batch';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('child-job batch — integration (S3)', () => {
  let prefix: string;
  let queueName: string;
  let connection: IORedis;
  let queueService: QueueService;
  let closers: (() => Promise<unknown>)[];
  let runs: string[];

  /** A consumer whose handler is `handle`, on its own connection. */
  const consume = (
    handle: (data: { n: string }) => Promise<unknown>,
    concurrency = 1,
  ) => {
    const workerConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    const worker = new Worker(
      queueName,
      async (job) => {
        runs.push(job.data.n);
        return handle(job.data);
      },
      { connection: workerConnection, prefix, concurrency },
    );
    closers.push(async () => {
      await worker.close();
      await workerConnection.quit();
    });
    return worker;
  };

  const open = async () => {
    const batch = await openQueueBatch<{ n: string }, string>({
      queueService,
      connection,
      prefix,
      queueName,
    });
    closers.push(() => batch.close());
    return batch;
  };

  const settle = async (
    batch: ChildJobBatch<{ n: string }, string>,
    options: Partial<Parameters<typeof settleChildJobs>[1]> = {},
  ) => {
    const outcomes: ChildOutcome<string>[] = [];
    const end = await settleChildJobs(batch, {
      onOutcome: (o) => outcomes.push(o),
      idleTimeoutMs: 20_000,
      pollMs: 50,
      ...options,
    });
    return { end, outcomes };
  };

  beforeEach(() => {
    prefix = `childjobs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    queueName = 'child-test';
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    queueService = new QueueService(connection, { prefix } as never);
    closers = [];
    runs = [];
    // One retry, quickly: the default is 3 attempts 30 s apart.
    process.env.BULLMQ_QUEUE_CHILD_TEST_ATTEMPTS = '2';
    process.env.BULLMQ_QUEUE_CHILD_TEST_BACKOFF_MS = '10';
  });

  afterEach(async () => {
    for (const close of closers.reverse()) await close();
    // QueueService.close() quits the shared connection too.
    await queueService.close();
    delete process.env.BULLMQ_QUEUE_CHILD_TEST_ATTEMPTS;
    delete process.env.BULLMQ_QUEUE_CHILD_TEST_BACKOFF_MS;
  });

  it('reports a job that finished — and was removed — before the parent waited', async () => {
    // The trap S3's design is built around: `waitUntilFinished` on a removed
    // job reads it as MISSING and rejects. The listener heard it finish.
    consume(async ({ n }) => `done-${n}`);
    const batch = await open();
    await batch.add({ n: 'a' }, 'job-a');
    await new Promise((r) => setTimeout(r, 500));

    const { end, outcomes } = await settle(batch);

    expect(end).toBe('settled');
    expect(outcomes).toEqual([{ jobId: 'job-a', ok: true, value: 'done-a' }]);
  });

  it('collapses an id onto a job in flight, and runs it again once finished', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    consume(async ({ n }) => {
      await gate;
      return n;
    });
    const batch = await open();
    await batch.add({ n: 'first' }, 'same');
    await batch.add({ n: 'second' }, 'same');
    release();
    const first = await settle(batch);

    expect(first.outcomes).toEqual([
      { jobId: 'same', ok: true, value: 'first' },
    ]);
    expect(runs).toEqual(['first']);

    // Removed on finish, so the id is free: a deleted block, or a
    // `resetWatermark` run, is not swallowed by last week's job.
    await batch.add({ n: 'third' }, 'same');
    await settle(batch);
    expect(runs).toEqual(['first', 'third']);
  });

  it('reports one failure for a job that failed every attempt', async () => {
    consume(async () => {
      throw new Error('runner died');
    });
    const batch = await open();
    await batch.add({ n: 'x' }, 'fails');

    const { outcomes } = await settle(batch);

    expect(runs).toEqual(['x', 'x']);
    expect(outcomes).toEqual([
      { jobId: 'fails', ok: false, reason: 'runner died' },
    ]);
  });

  it('a retry that succeeds reports success, not the failure before it', async () => {
    let attempt = 0;
    consume(async () => {
      attempt++;
      if (attempt === 1) throw new Error('first try');
      return 'second try';
    });
    const batch = await open();
    await batch.add({ n: 'x' }, 'retried');

    const { outcomes } = await settle(batch);

    expect(outcomes).toEqual([
      { jobId: 'retried', ok: true, value: 'second try' },
    ]);
  });

  it('on cancel, drops what has not started and waits out what has', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    consume(async ({ n }) => {
      started();
      await gate;
      return n;
    });
    const batch = await open();
    await batch.add({ n: 'running' }, 'r');
    await running;
    await batch.add({ n: 'waiting' }, 'w');

    const settling = settle(batch, { isCancelled: async () => true });
    await new Promise((r) => setTimeout(r, 200));
    release();
    const { end, outcomes } = await settling;

    expect(end).toBe('cancelled');
    expect(outcomes).toEqual([{ jobId: 'r', ok: true, value: 'running' }]);
    expect(runs).toEqual(['running']);
  });

  it('gives up on jobs nobody consumes, as failures, after the idle timeout', async () => {
    const batch = await open();
    await batch.add({ n: 'orphan' }, 'o');

    const { end, outcomes } = await settle(batch, { idleTimeoutMs: 300 });

    expect(end).toBe('timed-out');
    expect(outcomes).toEqual([
      expect.objectContaining({ jobId: 'o', ok: false }),
    ]);
    // Dropped from the queue too, so a consumer arriving later does not run
    // work its parent has already counted as failed.
    consume(async ({ n }) => n);
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toEqual([]);
  });

  it('abandoning after an abort waits for the running job before returning', async () => {
    let finished = false;
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    consume(async () => {
      started();
      await new Promise((r) => setTimeout(r, 300));
      finished = true;
      return 'late';
    });
    const batch = await open();
    await batch.add({ n: 'a' }, 'a');
    await running;
    await batch.add({ n: 'b' }, 'b');

    await abandonChildJobs(batch, 20_000);

    expect(finished).toBe(true);
    expect(runs).toEqual(['a']);
  });
});
