/**
 * S7 — the lane queue against real Redis and BullMQ
 * (`docs/plans/S7-gpu-lane-queue.md`).
 *
 * The property that matters is global: two worker processes, each with its
 * own lane worker, must still put only `globalConcurrency` requests on the
 * GPU at once. Only BullMQ's Redis-side `setGlobalConcurrency` can make that
 * true, so it is exercised for real, with two dispatchers on two connections
 * standing in for two processes. The provider is a fake that records how many
 * calls overlap — no Ollama needed.
 *
 * Jobs "from another process" are added with a bare BullMQ Queue, which is
 * exactly what a foreign producer — or anything else that can write to Redis
 * — looks like to a consumer.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import {
  laneQueueName,
  GPU_LANE_DISPATCHER,
  LLMError,
  type ILLMProvider,
} from '@opuspopuli/common';
import { LLMModule } from '@opuspopuli/llm-provider';
import {
  GpuLaneDispatcher,
  type LaneProviderFactory,
} from 'src/common/gpu-lane/gpu-lane.dispatcher';
import { GpuLaneModule } from 'src/common/gpu-lane/gpu-lane.module';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('GpuLaneDispatcher — integration (S7)', () => {
  let prefix: string;
  let connections: IORedis[];
  let dispatchers: GpuLaneDispatcher[];
  let closers: (() => Promise<unknown>)[];
  let active: number;
  let maxActive: number;
  let calls: string[];
  let options: unknown[];

  /** A provider whose calls take `ms` and record their overlap. */
  const slowFactory =
    (ms: number, fail?: string, tag = ''): LaneProviderFactory =>
    (endpoint) =>
      ({
        generate: async (prompt: string, opts?: unknown) => {
          calls.push(`${tag}${endpoint.model}:${prompt}`);
          options.push(opts);
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, ms));
          active -= 1;
          // As OllamaLLMProvider fails: an LLMError naming the operation.
          if (fail) throw new LLMError('ollama', 'generate', new Error(fail));
          return { text: `done:${prompt}`, tokensIn: 3, tokensOut: 2 };
        },
      }) as unknown as ILLMProvider;

  /** A distinct endpoint per test, so each gets its own lane queue. */
  const endpoint = (n: string) => ({
    url: `http://lane-test-${n}:11434`,
    model: 'fake',
  });
  const job = (n: string, prompt: string) => ({
    lane: 'analysis',
    endpoint: endpoint(n),
    prompt,
  });

  const connect = () => {
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    connections.push(connection);
    return connection;
  };

  const make = (
    globalConcurrency: number,
    factory: LaneProviderFactory,
    n: string,
    observer?: { observe: jest.Mock; increment: jest.Mock },
  ) => {
    const dispatcher = new GpuLaneDispatcher(
      connect(),
      { prefix, globalConcurrency, waitTimeoutMs: 30_000 },
      observer,
      factory,
    );
    dispatcher.register('analysis', endpoint(n));
    dispatchers.push(dispatcher);
    return dispatcher;
  };

  /** Add a job as another process would, and wait for its fate. */
  const foreign = async (n: string, data: Record<string, unknown>) => {
    const name = laneQueueName(endpoint(n).url);
    const queue = new Queue(name, { connection: connect(), prefix });
    const events = new QueueEvents(name, { connection: connect(), prefix });
    closers.push(
      () => events.close(),
      () => queue.close(),
    );
    await events.waitUntilReady();
    const added = await queue.add(name, {
      lane: 'analysis',
      endpoint: endpoint(n),
      prompt: 'forged',
      deadline: Date.now() + 30_000,
      producer: 'foreign',
      triggerSource: 'lane',
      ...data,
    });
    return { queue, outcome: added.waitUntilFinished(events, 10_000) };
  };

  const markAlive = (id: string) =>
    connections[0].set(`${prefix}:gpu-lane:producer:${id}`, '1', 'EX', 60);

  beforeEach(() => {
    prefix = `test-lane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    connections = [];
    dispatchers = [];
    closers = [];
    active = 0;
    maxActive = 0;
    calls = [];
    options = [];
  });

  afterEach(async () => {
    await Promise.allSettled(closers.map((c) => c()));
    await Promise.allSettled(dispatchers.map((d) => d.onModuleDestroy()));
    const admin = new IORedis(REDIS_URL);
    const keys = await admin.keys(`${prefix}:*`);
    if (keys.length > 0) await admin.del(...keys);
    await admin.quit();
    await Promise.allSettled(connections.map((c) => c.quit()));
  });

  it('runs one call at a time across two processes at global concurrency 1', async () => {
    const a = make(1, slowFactory(150), 'bound1');
    const b = make(1, slowFactory(150), 'bound1');

    const results = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) =>
        (i % 2 ? a : b).generate(job('bound1', `p${i}`)),
      ),
    );

    expect(results.map((r) => r.text).sort()).toEqual(
      ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].map((p) => `done:${p}`),
    );
    expect(maxActive).toBe(1);
  });

  it('lets two through at global concurrency 2 — the bound is the setting, not an accident', async () => {
    // Without this, a dispatcher that serialised everything for some other
    // reason would pass the test above.
    const a = make(2, slowFactory(300), 'bound2');
    const b = make(2, slowFactory(300), 'bound2');

    await Promise.all(
      [0, 1, 2, 3].map((i) => (i % 2 ? a : b).generate(job('bound2', `p${i}`))),
    );

    expect(maxActive).toBe(2);
  });

  it('reaches global concurrency 2 from ONE process — per-worker slots follow the bound', async () => {
    const a = make(2, slowFactory(300), 'one2');

    await Promise.all(
      [0, 1, 2, 3].map((i) => a.generate(job('one2', `p${i}`))),
    );

    expect(maxActive).toBe(2);
  });

  it('returns exactly what the provider returned', async () => {
    const a = make(1, slowFactory(1), 'result');

    await expect(a.generate(job('result', 'x'))).resolves.toEqual({
      text: 'done:x',
      tokensIn: 3,
      tokensOut: 2,
    });
  });

  it("rejects with an LLMError carrying the consumer's failure, wrapped once", async () => {
    const a = make(
      1,
      slowFactory(1, `model not found ${'x'.repeat(500)}`),
      'fail',
    );

    const error = await a.generate(job('fail', 'x')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LLMError);
    const message = (error as Error).message;
    expect(message).toContain('model not found');
    expect(message.match(/LLM operation/g)).toHaveLength(1);
    // Truncated before it crossed Redis.
    expect(message.length).toBeLessThan(400);
  });

  it('runs a job another process queued — any consumer serves any producer', async () => {
    const b = make(1, slowFactory(1, undefined, 'B:'), 'cross');
    await b.generate(job('cross', 'open')); // opens B's lane worker
    await markAlive('foreign');

    const { outcome } = await foreign('cross', { prompt: 'theirs' });

    await expect(outcome).resolves.toEqual(
      expect.objectContaining({ text: 'done:theirs' }),
    );
    expect(calls).toContain('B:fake:theirs');
  });

  it('refuses an endpoint this process never configured, without echoing it', async () => {
    const a = make(1, slowFactory(1), 'allow');
    await a.generate(job('allow', 'open'));
    await markAlive('foreign');

    const { outcome } = await foreign('allow', {
      endpoint: { url: endpoint('allow').url, model: 'attacker-model' },
    });

    const error = await outcome.catch((e: unknown) => e as Error);
    expect((error as Error).message).toContain('does not configure');
    expect((error as Error).message).not.toContain('attacker-model');
    expect((error as Error).message).not.toContain('lane-test-allow');
    expect(calls).toEqual(['fake:open']);
  });

  it('skips a job whose caller died — no GPU time for nobody', async () => {
    const a = make(1, slowFactory(1), 'orphan');
    await a.generate(job('orphan', 'open'));

    const { outcome } = await foreign('orphan', { producer: 'dead' });
    await expect(outcome).rejects.toThrow('no longer running');

    // The rest of a dead producer's backlog skips at once — remembered, not
    // re-checked through the grace on the only GPU slot each time.
    const startedAt = Date.now();
    const { outcome: next } = await foreign('orphan', { producer: 'dead' });
    await expect(next).rejects.toThrow('no longer running');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(calls).toEqual(['fake:open']);
  });

  it('serves a producer again once its key is back — "dead" is not forever', async () => {
    const a = make(1, slowFactory(1), 'revive');
    await a.generate(job('revive', 'open'));
    const { outcome } = await foreign('revive', { producer: 'stalled' });
    await expect(outcome).rejects.toThrow('no longer running');

    await markAlive('stalled');
    const { outcome: next } = await foreign('revive', {
      producer: 'stalled',
      prompt: 'back',
    });

    await expect(next).resolves.toEqual(
      expect.objectContaining({ text: 'done:back' }),
    );
  });

  it('runs a job whose producer reappears within the grace — a host that slept', async () => {
    const a = make(1, slowFactory(1), 'grace');
    await a.generate(job('grace', 'open'));

    const { outcome } = await foreign('grace', {
      producer: 'late',
      prompt: 'resumed',
    });
    setTimeout(() => void markAlive('late'), 1_000);

    await expect(outcome).resolves.toEqual(
      expect.objectContaining({ text: 'done:resumed' }),
    );
  });

  it('clamps the options a job carries — they are read from Redis', async () => {
    const a = make(1, slowFactory(1), 'clamp');
    await a.generate(job('clamp', 'open'));
    await markAlive('foreign');

    const { outcome } = await foreign('clamp', {
      options: { maxTokens: -1, requestTimeoutMs: 1e12, think: true },
    });
    await outcome;

    expect(options.at(-1)).toEqual({
      requestTimeoutMs: 3_700_000,
      think: true,
    });
  });

  it('skips a job whose caller has stopped waiting', async () => {
    const a = make(1, slowFactory(1), 'expired');
    await a.generate(job('expired', 'open'));
    await markAlive('foreign');

    const { outcome } = await foreign('expired', { deadline: Date.now() - 1 });

    await expect(outcome).rejects.toThrow('expired');
    expect(calls).toEqual(['fake:open']);
  });

  it('blanks the prompt in Redis once the consumer has read it', async () => {
    const a = make(1, slowFactory(1), 'strip');

    await a.generate(job('strip', 'personal interests'));

    const name = laneQueueName(endpoint('strip').url);
    const queue = new Queue(name, { connection: connect(), prefix });
    closers.push(() => queue.close());
    const [done] = await queue.getJobs(['completed']);
    expect(done.data.prompt).toBe('');
  });

  it('removes a job its caller gave up on before it reached the GPU', async () => {
    const a = new GpuLaneDispatcher(
      connect(),
      { prefix, globalConcurrency: 1, waitTimeoutMs: 300 },
      undefined,
      slowFactory(1_000),
    );
    a.register('analysis', endpoint('abandon'));
    dispatchers.push(a);

    // The first holds the only slot past the second's timeout.
    const first = a.generate(job('abandon', 'slow')).catch((e: unknown) => e);
    const second = await a
      .generate(job('abandon', 'gives-up'))
      .catch((e: unknown) => e);

    expect(second).toBeInstanceOf(LLMError);
    // Gone from the queue while the first still runs — not merely skipped
    // later by the deadline, which would still cost a consumer a turn.
    const queue = new Queue(laneQueueName(endpoint('abandon').url), {
      connection: connect(),
      prefix,
    });
    closers.push(() => queue.close());
    expect(await queue.getWaitingCount()).toBe(0);
    // And nothing left listening for a job that will now never finish.
    const lane = await (
      a as unknown as { lanes: Map<string, Promise<{ events: QueueEvents }>> }
    ).lanes.get(laneQueueName(endpoint('abandon').url));
    expect(
      lane!.events.eventNames().filter((e) => String(e).includes(':')),
    ).toEqual(expect.not.arrayContaining([expect.stringMatching(/:2$/)]));
    await first;
    expect(calls).not.toContain('fake:gives-up');
  });

  it('ages the results out of the events stream, not just by count', async () => {
    const a = make(1, slowFactory(1), 'trim');
    await a.generate(job('trim', 'x'));
    const key = `${prefix}:${laneQueueName(endpoint('trim').url)}:events`;
    expect(await connections[0].xlen(key)).toBeGreaterThan(0);

    // What the heartbeat does every tick, with "now" as the cutoff.
    await (
      a as unknown as { trimEvents: (minTime: number) => Promise<void> }
    ).trimEvents(Date.now() + 1);

    expect(await connections[0].xlen(key)).toBe(0);
  });

  it('shuts down cleanly after the shared queue connection is already gone', async () => {
    // Nest destroys QueueModule (and quits its connection) BEFORE this global
    // module; the dispatcher must still clear its liveness key on its own.
    const admin = connect();
    const shared = connect();
    const a = new GpuLaneDispatcher(
      shared,
      { prefix, globalConcurrency: 1, waitTimeoutMs: 30_000 },
      undefined,
      slowFactory(1),
    );
    a.register('analysis', endpoint('order'));
    await a.generate(job('order', 'x'));
    const keyPattern = `${prefix}:gpu-lane:producer:*`;
    expect(await admin.keys(keyPattern)).toHaveLength(1);

    await shared.quit();
    await a.onModuleDestroy();

    expect(await admin.keys(keyPattern)).toHaveLength(0);
  });

  it('rejects callers still waiting when the process shuts down', async () => {
    // Every timer armed for the wait timeout, and every timer cleared. Not a
    // count of the process's Timeout handles: CI runs every integration suite
    // in one worker, and someone else's stray timer failed that version.
    const set = jest.spyOn(global, 'setTimeout');
    const cleared = jest.spyOn(global, 'clearTimeout');
    const a = make(1, slowFactory(1_500), 'shutdown');
    const pending = a
      .generate(job('shutdown', 'slow'))
      .catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 200));

    const startedAt = Date.now();
    const destroyed = a.onModuleDestroy();
    const error = await pending;

    expect(error).toBeInstanceOf(LLMError);
    expect((error as Error).message).toContain('shutting down');
    // At once — not after the running call, nor after the wait timeout.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await destroyed;
    // Nothing left counting down the wait timeout: a leftover timer would
    // hold a stopping worker open until its container is killed.
    const waitTimers = set.mock.calls.flatMap((call, i) =>
      call[1] === 30_000 ? [set.mock.results[i].value] : [],
    );
    expect(waitTimers.length).toBeGreaterThan(0);
    const clearedHandles = new Set(cleared.mock.calls.map((c) => c[0]));
    for (const handle of waitTimers) expect(clearedHandles).toContain(handle);
    set.mockRestore();
    cleared.mockRestore();
  });

  it('records how long each call waited for the GPU', async () => {
    const observer = { observe: jest.fn(), increment: jest.fn() };
    const a = make(1, slowFactory(100), 'wait', observer);

    await Promise.all([
      a.generate(job('wait', '1')),
      a.generate(job('wait', '2')),
    ]);

    const waits = observer.observe.mock.calls.filter(
      (c) => c[0] === 'lane_wait_seconds',
    );
    expect(waits).toHaveLength(2);
    expect(waits[0][2]).toEqual({
      lane: 'analysis',
      endpoint: 'gpu-lane-lane-test-wait-11434',
    });
    // The second waited behind the first's ~100ms.
    expect(Math.max(...waits.map((w) => w[1] as number))).toBeGreaterThan(0.05);
  });
});

describe('GpuLaneModule.forRoot() — enabled, compiled for real (S7)', () => {
  const env = process.env.GPU_LANE_QUEUE_ENABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.GPU_LANE_QUEUE_ENABLED;
    else process.env.GPU_LANE_QUEUE_ENABLED = env;
  });

  it('resolves a dispatcher LLMModule routes through, and shuts down cleanly', async () => {
    process.env.GPU_LANE_QUEUE_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        GpuLaneModule.forRoot(),
        LLMModule,
      ],
    }).compile();

    expect(moduleRef.get(GPU_LANE_DISPATCHER)).toBeInstanceOf(
      GpuLaneDispatcher,
    );
    // The provider is the queue's wrapper, not Ollama's own class.
    expect(
      moduleRef.get<ILLMProvider>('LLM_ANALYSIS_PROVIDER').constructor.name,
    ).not.toBe('OllamaLLMProvider');
    await moduleRef.close();
  });
});
