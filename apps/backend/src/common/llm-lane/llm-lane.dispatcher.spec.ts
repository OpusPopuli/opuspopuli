import { Logger } from '@nestjs/common';
import type { ILLMProvider } from '@opuspopuli/common';

/**
 * The dispatcher's direct fallback (S7). The queued path — global bound,
 * results, failures, the endpoint allowlist, orphans, shutdown — is proven
 * against real Redis in `__tests__/integration/llm-lane`; a thrown enqueue
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
jest.mock('@opuspopuli/queue-provider', () => ({
  QUEUE_CONNECTION: 'QUEUE_CONNECTION',
  createWorker: jest.fn().mockReturnValue({ close: jest.fn() }),
  withTraceContext: (d: unknown) => d,
}));

import { LlmLaneDispatcher, safeOptions } from './llm-lane.dispatcher';

describe('LlmLaneDispatcher — direct fallback (S7)', () => {
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
  let dispatcher: LlmLaneDispatcher;
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
    dispatcher = new LlmLaneDispatcher(
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
