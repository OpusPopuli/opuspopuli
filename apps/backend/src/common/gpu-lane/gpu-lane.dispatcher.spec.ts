import { Logger } from '@nestjs/common';
import type { ILLMProvider } from '@opuspopuli/common';

/**
 * The dispatcher's direct fallback (S7). The queued path — global bound,
 * results, failures, the endpoint allowlist, orphans, shutdown — is proven
 * against real Redis in `__tests__/integration/gpu-lane`; a thrown enqueue
 * cannot easily be caused there, so BullMQ is mocked here.
 */
const add = jest.fn();
let failOpen = (_name: string) => false;
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    setMaxListeners: jest.fn(),
    getGlobalConcurrency: jest.fn(() =>
      failOpen(name)
        ? Promise.reject(new Error('open failed'))
        : Promise.resolve(null),
    ),
    setGlobalConcurrency: jest.fn().mockResolvedValue(undefined),
    add,
    close: jest.fn(),
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    waitUntilReady: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  })),
}));
// The 15 s re-check, made instant: the loop is what is under test. Past 50
// waits it throws, synchronously so the loop's own catch of an aborted sleep
// can't swallow it, and a loop that never ends fails the test instead of
// exhausting the heap.
let waits = 0;
/** Runs during each wait, as if it happened mid-sleep. */
let duringWait: () => void = () => undefined;
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn(() => {
    if (++waits > 50) throw new Error('waited without end');
    duringWait();
    return Promise.resolve(undefined);
  }),
}));
jest.mock('@opuspopuli/queue-provider', () => ({
  QUEUE_CONNECTION: 'QUEUE_CONNECTION',
  createWorker: jest.fn().mockReturnValue({ close: jest.fn() }),
  withTraceContext: (d: unknown) => d,
}));

import { createWorker } from '@opuspopuli/queue-provider';
import { HostMemoryUnavailableError } from '@opuspopuli/llm-provider';
import { GpuLaneDispatcher, safeOptions } from './gpu-lane.dispatcher';

describe('GpuLaneDispatcher — direct fallback (S7)', () => {
  const redis = {
    quit: jest.fn().mockResolvedValue('OK'),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    xtrim: jest.fn().mockResolvedValue(0),
    duplicate: () => ({ quit: jest.fn().mockResolvedValue('OK') }),
  };
  const connection = { duplicate: () => redis };
  const endpoint = { url: 'http://ollama:11434', model: 'm' };
  const job = { lane: 'analysis', endpoint, prompt: 'P' };
  let dispatcher: GpuLaneDispatcher;
  let generate: jest.Mock;
  let factory: jest.Mock;

  beforeEach(() => {
    add.mockReset();
    failOpen = () => false;
    redis.set.mockReset().mockResolvedValue('OK');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    generate = jest.fn().mockResolvedValue({ text: 'direct' });
    factory = jest.fn(() => ({ generate }) as unknown as ILLMProvider);
    dispatcher = new GpuLaneDispatcher(
      connection as never,
      { prefix: 'bullmq', globalConcurrency: 1, waitTimeoutMs: 1000 },
      undefined,
      factory,
    );
    dispatcher.register('analysis', { ...endpoint, requestTimeoutMs: 42 });
  });

  afterEach(async () => {
    await dispatcher.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('calls the endpoint directly when the enqueue throws', async () => {
    add.mockRejectedValue(new Error('WRONGTYPE'));

    await expect(dispatcher.generate(job)).resolves.toEqual({ text: 'direct' });

    expect(generate).toHaveBeenCalledWith('P', undefined);
  });

  it('warns once a minute however many calls fall back, counting them', async () => {
    add.mockRejectedValue(new Error('WRONGTYPE'));

    await dispatcher.generate(job);
    await dispatcher.generate(job);
    await dispatcher.generate(job);

    expect(generate).toHaveBeenCalledTimes(3);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the lane lock long (>= 5 min), and stalls still fail rather than re-run', async () => {
    // At 30 s, the 2026-10-23 civics baseline lost two live calls: the host
    // idle-slept while swapping, two jobs lost their lock, and with no stall
    // retries they failed while Ollama kept generating them. Five minutes —
    // createWorker's default — survives a pause of at least ~150 s.
    (createWorker as jest.Mock).mockClear();
    add.mockResolvedValue({
      id: '1',
      waitUntilFinished: () => Promise.resolve({ text: 'q' }),
      remove: jest.fn(),
    });

    await dispatcher.generate(job);

    expect(createWorker).toHaveBeenCalledTimes(1);
    const opts = (createWorker as jest.Mock).mock.calls[0][3];
    expect(opts.lockDuration).toBeGreaterThanOrEqual(300_000);
    // Still no second run of a stalled job: its first may be on the GPU.
    expect(opts.maxStalledCount).toBe(0);
  });

  it('starts one heartbeat, however other lanes fail while it publishes', async () => {
    // Lane A is mid-publish when lane B fails to open; B's failure must not
    // let a third call start a second, never-cleared interval.
    let publish!: () => void;
    redis.set.mockReturnValueOnce(
      new Promise((resolve) => {
        publish = () => resolve('OK');
      }),
    );
    failOpen = (name) => name.includes('bad');
    add.mockResolvedValue({
      id: '1',
      waitUntilFinished: () => Promise.resolve({ text: 'q' }),
      remove: jest.fn(),
    });
    dispatcher.register('ingestion', { url: 'http://bad:11434', model: 'm' });
    const intervals = jest.spyOn(global, 'setInterval');

    const a = dispatcher.generate(job);
    await new Promise((r) => setImmediate(r));
    await dispatcher.generate({
      lane: 'ingestion',
      endpoint: { url: 'http://bad:11434', model: 'm' },
      prompt: 'B',
    });
    const c = dispatcher.generate(job);
    publish();
    await Promise.all([a, c]);

    expect(intervals).toHaveBeenCalledTimes(1);
  });
});

describe('GpuLaneDispatcher — waiting for host memory (#1434)', () => {
  const redis = {
    quit: jest.fn().mockResolvedValue('OK'),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    xtrim: jest.fn().mockResolvedValue(0),
    exists: jest.fn().mockResolvedValue(1),
    duplicate: () => ({ quit: jest.fn().mockResolvedValue('OK') }),
  };
  const endpoint = { url: 'http://ollama:11434', model: 'm' };
  const WAIT_MS = 60 * 60_000;
  const noRoom = () =>
    new HostMemoryUnavailableError('Ollama', 'generate', 'deferred', {
      model: 'm',
    });
  let dispatcher: GpuLaneDispatcher;
  let generate: jest.Mock;

  /** The consumer createWorker was given, run on one job. */
  async function consume(
    deadlineInMs: number,
    data: { producer?: string; deadline?: unknown } = {},
    queuedAgoMs = 0,
  ) {
    (createWorker as jest.Mock).mockClear();
    add.mockResolvedValue({
      id: '1',
      waitUntilFinished: () => Promise.resolve({ text: 'q' }),
      remove: jest.fn(),
    });
    await dispatcher.generate({ lane: 'analysis', endpoint, prompt: 'P' });
    const processor = (createWorker as jest.Mock).mock.calls[0][2];
    return processor({
      id: '9',
      timestamp: Date.now() - queuedAgoMs,
      processedOn: Date.now(),
      updateData: jest.fn().mockResolvedValue(undefined),
      data: {
        lane: 'analysis',
        endpoint,
        prompt: 'P',
        deadline: Date.now() + deadlineInMs,
        producer: (dispatcher as unknown as { producerId: string }).producerId,
        triggerSource: 'lane',
        ...data,
      },
    });
  }

  beforeEach(() => {
    waits = 0;
    duringWait = () => undefined;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    generate = jest.fn();
    dispatcher = new GpuLaneDispatcher(
      { duplicate: () => redis } as never,
      { prefix: 'bullmq', globalConcurrency: 1, waitTimeoutMs: WAIT_MS },
      undefined,
      () => ({ generate }) as unknown as ILLMProvider,
    );
    dispatcher.register('analysis', endpoint);
  });

  afterEach(async () => {
    await dispatcher.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('keeps the job and tries again once the host has room', async () => {
    generate
      .mockRejectedValueOnce(noRoom())
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValue({ text: 'done' });

    await expect(consume(10 * 60_000)).resolves.toEqual({ text: 'done' });
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('gives up as deferred when the deadline comes first', async () => {
    generate.mockRejectedValue(noRoom());

    await expect(consume(5_000)).rejects.toThrow(/reclaimable/);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not start a load after shutdown begins during a wait', async () => {
    generate.mockRejectedValueOnce(noRoom()).mockResolvedValue({ text: 'x' });
    // Not awaited: shutdown begins mid-sleep and finishes on its own.
    duringWait = () => {
      dispatcher.onModuleDestroy().catch(() => undefined);
    };

    await expect(consume(10 * 60_000)).rejects.toThrow(/shutting down/);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('ends a wait on the stop signal, before the module is destroyed', async () => {
    // Nest destroys this module after every queue worker has closed, and a
    // worker waits for its job: the wait must end on the signal itself.
    const onStop = (dispatcher as unknown as { onStopSignal: () => void })
      .onStopSignal;
    // Registered at init, after Nest's own shutdown hooks, not at construction.
    expect(process.listeners('SIGTERM')).not.toContain(onStop);
    dispatcher.onModuleInit();
    expect(process.listeners('SIGTERM')).toContain(onStop);
    generate.mockRejectedValueOnce(noRoom()).mockResolvedValue({ text: 'x' });
    duringWait = onStop;

    await expect(consume(10 * 60_000)).rejects.toThrow(/shutting down/);
    expect(generate).toHaveBeenCalledTimes(1);

    await dispatcher.onModuleDestroy();
    expect(process.listeners('SIGTERM')).not.toContain(onStop);
    expect(process.listeners('SIGINT')).not.toContain(onStop);
  });

  it('does not wait at all once shutdown has begun', async () => {
    generate.mockImplementationOnce(() => {
      dispatcher.onModuleDestroy().catch(() => undefined);
      return Promise.reject(noRoom());
    });

    await expect(consume(10 * 60_000)).rejects.toThrow(/reclaimable/);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(waits).toBe(0);
  });

  it('stops waiting once its caller is gone', async () => {
    const internals = dispatcher as unknown as { deadProducers: Set<string> };
    generate.mockImplementationOnce(() => {
      // The caller's liveness key lapses while the job waits.
      redis.exists.mockResolvedValue(0);
      internals.deadProducers.add('caller');
      return Promise.reject(noRoom());
    });

    await expect(consume(10 * 60_000, { producer: 'caller' })).rejects.toThrow(
      /no longer running/,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    redis.exists.mockResolvedValue(1);
  });

  it('holds the slot no longer than this process would have set', async () => {
    // A job read from Redis asking to wait for ever, queued almost as long
    // ago as this process's own wait limit: its real deadline is moments
    // away, nearer than the next recheck, so it gets one call and no wait.
    // Queued exactly WAIT_MS ago, the deadline would be "now" and a runner
    // that spent a millisecond getting to the pre-call check would expire
    // the job before the call this test is about (flaked in CI on #1438).
    generate.mockRejectedValue(noRoom());

    await expect(
      consume(0, { deadline: Number.MAX_SAFE_INTEGER }, WAIT_MS - 5_000),
    ).rejects.toThrow(/reclaimable/);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('treats a deadline that is not a number as passed', async () => {
    await expect(consume(0, { deadline: 'soon' })).rejects.toThrow(
      /expired before a GPU slot came free/,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not retry any other failure', async () => {
    generate.mockRejectedValue(new Error('HTTP 500'));

    await expect(consume(10 * 60_000)).rejects.toThrow('HTTP 500');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('safeOptions — what a job from Redis may ask of the GPU (S7)', () => {
  it('passes legitimate options through unchanged', () => {
    const civics = {
      maxTokens: 64_000,
      requestTimeoutMs: 3_600_000,
      temperature: 0.1,
      topP: 0.9,
      topK: 40,
      think: false,
      seed: 7,
      stopSequences: ['</json>'],
    };
    expect(safeOptions(civics)).toEqual(civics);
  });

  it('drops unbounded or unknown values and clamps the rest', () => {
    expect(
      safeOptions({
        maxTokens: -1,
        requestTimeoutMs: 1e12,
        stream: true,
        seed: 1.5,
        stopSequences: Array.from({ length: 50 }, (_, i) => `s${i}`),
        ...({ url: 'http://elsewhere' } as object),
      }),
    ).toEqual({
      requestTimeoutMs: 3_700_000,
      stopSequences: Array.from({ length: 16 }, (_, i) => `s${i}`),
    });
    expect(safeOptions({ maxTokens: 10_000_000 })).toEqual({
      maxTokens: 131_072,
    });
    expect(safeOptions(undefined)).toBeUndefined();
  });
});
