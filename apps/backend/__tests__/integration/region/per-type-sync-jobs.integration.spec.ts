/**
 * S2 — one region-sync job per data type, against real Postgres, Redis and
 * BullMQ (`docs/plans/S2-per-type-sync-jobs.md`).
 *
 * The properties that matter are cross-process: two worker processes on one
 * queue, at concurrency 2, must run different types side by side and never
 * the same type twice at once; a fanned-out request must close exactly when
 * its last child does. So two real `RegionSyncProcessor`s consume one real
 * queue here, writing real `pipeline_jobs` rows. Only the sync itself is a
 * fake — one that records which types overlap.
 */
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  JOB_STATUS,
  QueueService,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import { PipelineJobService } from '../../../src/apps/region/src/domains/pipeline-job.service';
import { RegionSyncProcessor } from '../../../src/apps/workers/region-worker/src/region-sync.processor';
import { DataTypeLock } from '../../../src/apps/workers/region-worker/src/data-type-lock';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('pipeline_jobs for fanned-out requests (S2)', () => {
  let db: DbService;
  let jobs: PipelineJobService;
  const host = process.env.WORKER_HOST;

  beforeAll(async () => {
    db = await getDbService();
    jobs = new PipelineJobService(db);
  });
  beforeEach(async () => {
    await cleanDatabase();
    process.env.WORKER_HOST = 'host-a';
  });
  afterAll(async () => {
    if (host === undefined) delete process.env.WORKER_HOST;
    else process.env.WORKER_HOST = host;
    await disconnectDatabase();
  });

  const row = (data: Record<string, unknown> = {}) =>
    db.pipelineJob.create({
      data: {
        bullmqJobId: `b-${Math.random()}`,
        triggerSource: TRIGGER_SOURCE.MANUAL,
        dataTypes: [],
        status: JOB_STATUS.QUEUED,
        ...data,
      },
    });
  const statusOf = async (id: string) =>
    (await db.pipelineJob.findUniqueOrThrow({ where: { id } })).status;
  const stale = new Date(Date.now() - 60 * 60_000);

  it('records which host ran a job', async () => {
    const job = await row();

    await jobs.markRunning(job.id, 'bull-1');

    expect(
      (await db.pipelineJob.findUniqueOrThrow({ where: { id: job.id } }))
        .workerHost,
    ).toBe('host-a');
  });

  it("sweeps only this host's stale rows and pre-S2 rows, never another host's or a parent", async () => {
    const running = { status: JOB_STATUS.RUNNING, startedAt: stale };
    const mine = await row({ ...running, workerHost: 'host-a' });
    const legacy = await row({ ...running, workerHost: null });
    const theirs = await row({ ...running, workerHost: 'host-b' });
    const parent = await row({ ...running, workerHost: 'host-a' });
    await row({ parentJobId: parent.id, status: JOB_STATUS.QUEUED });
    const fresh = await row({
      status: JOB_STATUS.RUNNING,
      startedAt: new Date(),
      workerHost: 'host-a',
    });

    expect(await jobs.sweepStaleRunning(600_000)).toBe(2);

    expect(await statusOf(mine.id)).toBe(JOB_STATUS.FAILED);
    expect(await statusOf(legacy.id)).toBe(JOB_STATUS.FAILED);
    expect(await statusOf(theirs.id)).toBe(JOB_STATUS.RUNNING);
    expect(await statusOf(parent.id)).toBe(JOB_STATUS.RUNNING);
    expect(await statusOf(fresh.id)).toBe(JOB_STATUS.RUNNING);
  });

  it("settles a swept child's parent", async () => {
    const parent = await row({ status: JOB_STATUS.RUNNING });
    await row({
      parentJobId: parent.id,
      status: JOB_STATUS.RUNNING,
      startedAt: stale,
      workerHost: 'host-a',
      dataTypes: ['bills'],
    });

    await jobs.sweepStaleRunning(600_000);

    expect(await statusOf(parent.id)).toBe(JOB_STATUS.FAILED);
  });

  it("closes a parent with its children's results once the last one finishes", async () => {
    const parent = await row({ status: JOB_STATUS.RUNNING });
    const result = (dataType: string) => [{ dataType, itemsProcessed: 1 }];
    await row({
      parentJobId: parent.id,
      status: JOB_STATUS.SUCCEEDED,
      dataTypes: ['bills'],
      result: result('bills'),
      finishedAt: new Date(),
    });
    const open = await row({
      parentJobId: parent.id,
      status: JOB_STATUS.RUNNING,
      dataTypes: ['meetings'],
    });

    expect(await jobs.settleParent(parent.id)).toBe(false);
    expect(await statusOf(parent.id)).toBe(JOB_STATUS.RUNNING);

    await db.pipelineJob.update({
      where: { id: open.id },
      data: {
        status: JOB_STATUS.SUCCEEDED,
        result: result('meetings'),
        finishedAt: new Date(),
      },
    });
    // Two children finishing together both settle, writing the same thing.
    const settled = await Promise.all([
      jobs.settleParent(parent.id),
      jobs.settleParent(parent.id),
    ]);

    expect(settled).toEqual([true, true]);
    const closed = await db.pipelineJob.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(closed.status).toBe(JOB_STATUS.SUCCEEDED);
    expect(closed.result).toEqual([...result('bills'), ...result('meetings')]);
  });

  it('corrects a parent the sweep closed when its swept child then succeeds', async () => {
    // A redeploy sweeps the long child (usually bills) and closes the parent
    // FAILED; BullMQ then redelivers the stalled job, which succeeds.
    const parent = await row({ status: JOB_STATUS.RUNNING });
    const child = await row({
      parentJobId: parent.id,
      status: JOB_STATUS.RUNNING,
      startedAt: stale,
      workerHost: 'host-a',
      dataTypes: ['bills'],
    });
    await jobs.sweepStaleRunning(600_000);
    expect(await statusOf(parent.id)).toBe(JOB_STATUS.FAILED);

    await jobs.markRunning(child.id, 'bull-again');
    await jobs.markSucceeded(child.id, []);
    await jobs.settleParent(parent.id);

    expect(await statusOf(parent.id)).toBe(JOB_STATUS.SUCCEEDED);
  });

  it('never reopens, or overwrites, a cancelled job', async () => {
    const cancelled = await row({ status: JOB_STATUS.CANCELLED });

    await jobs.markRunning(cancelled.id, 'bull-1');
    expect(await statusOf(cancelled.id)).toBe(JOB_STATUS.CANCELLED);
    await jobs.markSucceeded(cancelled.id, []);
    expect(await statusOf(cancelled.id)).toBe(JOB_STATUS.CANCELLED);
    await jobs.markFailed(cancelled.id, 'x');
    expect(await statusOf(cancelled.id)).toBe(JOB_STATUS.CANCELLED);
  });

  it('marks a parent running unless it succeeded or was cancelled', async () => {
    const open = await row({ enqueuedBy: 'admin-1' });
    // Swept before it fanned out: its redelivery must still fan out.
    const swept = await row({ status: JOB_STATUS.FAILED });
    const closed = await row({ status: JOB_STATUS.SUCCEEDED });
    const cancelled = await row({ status: JOB_STATUS.CANCELLED });

    expect(await jobs.markParentRunning(open.id, 'b')).toEqual({
      enqueuedBy: 'admin-1',
    });
    expect(await jobs.markParentRunning(swept.id, 'b')).not.toBeNull();
    expect(await jobs.markParentRunning(closed.id, 'b')).toBeNull();
    expect(await jobs.markParentRunning(cancelled.id, 'b')).toBeNull();
    expect(await statusOf(closed.id)).toBe(JOB_STATUS.SUCCEEDED);
  });

  it("gives a parent a failed fan-out closed early its children's results once they finish", async () => {
    const parent = await row({
      status: JOB_STATUS.FAILED,
      errorMessage: 'Fan-out failed: redis gone',
    });
    await row({
      parentJobId: parent.id,
      status: JOB_STATUS.SUCCEEDED,
      dataTypes: ['bills'],
      result: [{ dataType: 'bills' }],
      finishedAt: new Date(),
    });
    await row({
      parentJobId: parent.id,
      status: JOB_STATUS.FAILED,
      dataTypes: ['meetings'],
      finishedAt: new Date(),
    });

    await jobs.settleParent(parent.id);

    const closed = await db.pipelineJob.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(closed.status).toBe(JOB_STATUS.FAILED);
    expect(closed.errorMessage).toBe('Failed: meetings');
    expect(closed.result).toEqual([{ dataType: 'bills' }]);
  });

  it('closes, at startup, a running request whose children have all finished', async () => {
    // Its last child's own settle failed, so nothing else would ever close it.
    const stuck = await row({ status: JOB_STATUS.RUNNING });
    await row({
      parentJobId: stuck.id,
      status: JOB_STATUS.SUCCEEDED,
      dataTypes: ['bills'],
    });
    const busy = await row({ status: JOB_STATUS.RUNNING });
    await row({
      parentJobId: busy.id,
      status: JOB_STATUS.RUNNING,
      dataTypes: ['bills'],
    });
    const plain = await row({ status: JOB_STATUS.RUNNING });

    expect(await jobs.settleFinishedParents()).toBe(1);

    expect(await statusOf(stuck.id)).toBe(JOB_STATUS.SUCCEEDED);
    expect(await statusOf(busy.id)).toBe(JOB_STATUS.RUNNING);
    expect(await statusOf(plain.id)).toBe(JOB_STATUS.RUNNING);
  });

  it("finds a cron job's own row, never an older job's that reused its id", async () => {
    const old = await row({ bullmqJobId: 'repeat:x:1' });
    const queuedAt = new Date(Date.now() + 1_000);
    expect(await jobs.findByBullmqJobId('repeat:x:1', queuedAt)).toBeNull();

    expect(await jobs.findByBullmqJobId('repeat:x:1', old.enqueuedAt)).toEqual({
      id: old.id,
    });
  });

  it('sweeps every host when WORKER_HOST is unset, as before S2', async () => {
    // An unset WORKER_HOST means the hostname — a container id that changes
    // on every recreate — so scoping by it would strand every row a
    // previous container left behind.
    delete process.env.WORKER_HOST;
    const old = await row({
      status: JOB_STATUS.RUNNING,
      startedAt: stale,
      workerHost: 'a-container-that-no-longer-exists',
    });

    expect(await jobs.sweepStaleRunning(600_000)).toBe(1);
    expect(await statusOf(old.id)).toBe(JOB_STATUS.FAILED);
  });

  it('fails a parent naming the type that failed', async () => {
    const parent = await row({ status: JOB_STATUS.RUNNING });
    await row({
      parentJobId: parent.id,
      status: JOB_STATUS.SUCCEEDED,
      dataTypes: ['bills'],
    });
    await row({
      parentJobId: parent.id,
      status: JOB_STATUS.FAILED,
      dataTypes: ['meetings'],
    });

    await jobs.settleParent(parent.id);

    const closed = await db.pipelineJob.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(closed.status).toBe(JOB_STATUS.FAILED);
    expect(closed.errorMessage).toBe('Failed: meetings');
  });

  it("cancels a parent's open children, and a late child reads its parent's cancel", async () => {
    const parent = await row({ status: JOB_STATUS.RUNNING });
    const waiting = await row({
      parentJobId: parent.id,
      bullmqJobId: 'p-bills',
      dataTypes: ['bills'],
    });
    const done = await row({
      parentJobId: parent.id,
      status: JOB_STATUS.SUCCEEDED,
      dataTypes: ['meetings'],
    });

    await jobs.cancel(parent.id, 'test');
    expect(await jobs.cancelChildren(parent.id, 'test')).toEqual(['p-bills']);

    expect(await statusOf(waiting.id)).toBe(JOB_STATUS.CANCELLED);
    expect(await statusOf(done.id)).toBe(JOB_STATUS.SUCCEEDED);
    const late = await row({ parentJobId: parent.id, dataTypes: ['civics'] });
    expect(await jobs.isCancelled(late.id)).toBe(true);
  });

  it('lists requests, not their children', async () => {
    const parent = await row();
    await row({ parentJobId: parent.id });

    const recent = await jobs.findRecent(20);

    expect(recent.map((r) => r.jobId)).toEqual([parent.id]);
  });
});

describe('DataTypeLock (S2)', () => {
  let a: IORedis;
  let b: IORedis;
  const prefix = `test-lock-${Date.now()}`;

  beforeAll(() => {
    a = new IORedis(REDIS_URL);
    b = new IORedis(REDIS_URL);
  });
  afterAll(async () => {
    const keys = await a.keys(`${prefix}:*`);
    if (keys.length) await a.del(...keys);
    await a.quit();
    await b.quit();
  });

  it('lets one process hold a type, and the next take it once released', async () => {
    const first = await new DataTypeLock(a, prefix, 60_000).acquire('bills');
    expect(first).not.toBeNull();
    expect(
      await new DataTypeLock(b, prefix, 60_000).acquire('bills'),
    ).toBeNull();
    // Another type is unaffected.
    const other = await new DataTypeLock(b, prefix, 60_000).acquire('meetings');
    expect(other).not.toBeNull();

    await first!.release();
    const second = await new DataTypeLock(b, prefix, 60_000).acquire('bills');
    expect(second).not.toBeNull();
    await second!.release();
    await other!.release();
  });

  it('takes a lapsed lock back while its holder still runs', async () => {
    // A stall longer than the TTL lets the key expire; the next renewal must
    // restore it, or a second sync of the type could start beside this one.
    const held = await new DataTypeLock(a, prefix, 300).acquire('votes');
    const key = `${prefix}:locks:region-sync:votes`;
    const token = await a.get(key);
    await a.del(key);

    // Within a few renewals (every 100 ms) — polled, not a fixed sleep, so a
    // loaded machine delaying one tick does not fail it.
    const deadline = Date.now() + 3_000;
    while ((await a.get(key)) !== token && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(await a.get(key)).toBe(token);
    expect(await new DataTypeLock(b, prefix, 300).acquire('votes')).toBeNull();
    await held!.release();
  });

  it('never releases a lock another holder has taken since', async () => {
    // A holder whose lock lapsed (a stall past the TTL) must not delete the
    // lock the next holder took.
    const held = await new DataTypeLock(a, prefix, 60_000).acquire('civics');
    const key = `${prefix}:locks:region-sync:civics`;
    await a.set(key, 'someone-else');

    await held!.release();

    expect(await a.get(key)).toBe('someone-else');
  });
});

describe('two region workers on one queue (S2)', () => {
  let db: DbService;
  let jobs: PipelineJobService;
  let connections: IORedis[];
  let processors: RegionSyncProcessor[];
  let queues: QueueService[];
  let prefix: string;
  let running: Map<string, number>;
  let maxPerType: Map<string, number>;
  let active: number;
  let maxActive: number;
  const concurrency = process.env.BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY;

  /** A sync of one type that takes `ms` and records what overlapped it. */
  const regionService = (ms: number) => ({
    syncableDataTypes: async () => ['propositions', 'bills', 'meetings'],
    syncAll: async (types: string[]) => {
      const type = types[0];
      running.set(type, (running.get(type) ?? 0) + 1);
      maxPerType.set(
        type,
        Math.max(maxPerType.get(type) ?? 0, running.get(type)!),
      );
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active -= 1;
      running.set(type, running.get(type)! - 1);
      return [
        {
          regionId: 'test',
          dataType: type,
          itemsProcessed: 1,
          itemsCreated: 1,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: [],
          syncedAt: new Date(),
        },
      ];
    },
  });

  const startWorker = async (ms: number) => {
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    connections.push(connection);
    const settings: Record<string, string> = {
      BULLMQ_PREFIX: prefix,
      REGION_SYNC_LOCK_RETRY_MS: '200',
    };
    const config = {
      get: (key: string) => settings[key],
    } as unknown as ConfigService;
    const queue = new QueueService(connection, { prefix, url: REDIS_URL });
    queues.push(queue);
    const processor = new RegionSyncProcessor(
      regionService(ms) as never,
      jobs,
      {} as never,
      connection,
      config,
      queue,
    );
    processors.push(processor);
    await processor.onApplicationBootstrap();
    return queue;
  };

  /** Enqueue a request as `syncRegionData` does: row first, then job. */
  const request = async (queue: QueueService, dataTypes?: string[]) => {
    const row = await jobs.create({
      bullmqJobId: `req-${Math.random().toString(36).slice(2)}`,
      triggerSource: TRIGGER_SOURCE.MANUAL,
      dataTypes,
    });
    await queue.enqueue(
      REGION_SYNC_QUEUE,
      {
        pipelineJobId: row.id,
        triggerSource: TRIGGER_SOURCE.MANUAL,
        dataTypes,
      },
      { jobId: row.id },
    );
    return row.id;
  };

  const finished = async (id: string, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await db.pipelineJob.findUniqueOrThrow({ where: { id } });
      if (
        ![JOB_STATUS.QUEUED, JOB_STATUS.RUNNING].includes(row.status as never)
      )
        return row;
      if (Date.now() > deadline) throw new Error(`${id} still ${row.status}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    db = await getDbService();
    jobs = new PipelineJobService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
    process.env.BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY = '2';
    prefix = `test-s2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    connections = [];
    processors = [];
    queues = [];
    running = new Map();
    maxPerType = new Map();
    active = 0;
    maxActive = 0;
  });

  afterEach(async () => {
    await Promise.allSettled(processors.map((p) => p.onModuleDestroy()));
    const admin = new IORedis(REDIS_URL);
    const keys = await admin.keys(`${prefix}:*`);
    if (keys.length) await admin.del(...keys);
    await admin.quit();
    await Promise.allSettled(queues.map((q) => q.close()));
    await Promise.allSettled(connections.map((c) => c.quit()));
    if (concurrency === undefined)
      delete process.env.BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY;
    else process.env.BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY = concurrency;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('fans a request out, runs different types side by side, and closes it with every result', async () => {
    const queue = await startWorker(400);
    await startWorker(400);

    const parent = await finished(await request(queue));

    expect(parent.status).toBe(JOB_STATUS.SUCCEEDED);
    expect(
      (parent.result as { dataType: string }[]).map((r) => r.dataType).sort(),
    ).toEqual(['bills', 'meetings', 'propositions']);
    // Side by side — the point of S2 …
    expect(maxActive).toBeGreaterThanOrEqual(2);
    // … and the children are one row each, under the parent.
    expect(
      await db.pipelineJob.count({ where: { parentJobId: parent.id } }),
    ).toBe(3);
  });

  it('never runs two syncs of one type at once, across processes, and runs both', async () => {
    const queue = await startWorker(400);
    await startWorker(400);

    const ids = await Promise.all([
      request(queue, ['bills']),
      request(queue, ['bills']),
      request(queue, ['bills']),
    ]);
    const rows = await Promise.all(ids.map((id) => finished(id)));

    expect(rows.map((r) => r.status)).toEqual([
      JOB_STATUS.SUCCEEDED,
      JOB_STATUS.SUCCEEDED,
      JOB_STATUS.SUCCEEDED,
    ]);
    expect(maxPerType.get('bills')).toBe(1);
    // Waiting for the lock cost no BullMQ attempt: one finished attempt
    // each, however many times they were put back to wait.
    const bull = new Queue(REGION_SYNC_QUEUE, {
      connection: connections[0],
      prefix,
    });
    const made = await Promise.all(
      ids.map(async (id) => (await bull.getJob(id))!.attemptsMade),
    );
    await bull.close();
    expect(made).toEqual([1, 1, 1]);
  });

  it('runs different types side by side within ONE process at concurrency 2', async () => {
    // Two processes would overlap at concurrency 1 too; one process shows
    // the worker's own concurrency is what lets them.
    const queue = await startWorker(400);

    await finished(await request(queue));

    expect(maxActive).toBe(2);
  });

  it('cancels a request mid-run: waiting children never run, the running one ends cancelled', async () => {
    process.env.BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY = '1';
    const queue = await startWorker(1_500);
    const parentId = await request(queue);
    // Wait until the first child (bills, enqueued first) is running.
    for (let i = 0; i < 100 && active === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    await jobs.cancel(parentId, 'test');
    for (const queued of await jobs.cancelChildren(parentId, 'test')) {
      await queue.removeJobIfPending(REGION_SYNC_QUEUE, queued);
    }
    await new Promise((r) => setTimeout(r, 2_500));

    const children = await db.pipelineJob.findMany({
      where: { parentJobId: parentId },
    });
    expect(children.map((c) => c.status)).toEqual([
      JOB_STATUS.CANCELLED,
      JOB_STATUS.CANCELLED,
      JOB_STATUS.CANCELLED,
    ]);
    const parent = await db.pipelineJob.findUniqueOrThrow({
      where: { id: parentId },
    });
    expect(parent.status).toBe(JOB_STATUS.CANCELLED);
    // Only the one already running reached the sync.
    expect([...maxPerType.keys()]).toEqual(['bills']);
  });
});
