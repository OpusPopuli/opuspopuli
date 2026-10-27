import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  GPU_LANE_DISPATCHER,
  LlmMetric,
  METRICS_OBSERVER,
  type ILLMProvider,
  type IGpuLaneDispatcher,
} from '@opuspopuli/common';
import { LLMModule } from '@opuspopuli/llm-provider';
import { GpuLaneModule, positiveInt } from './gpu-lane.module';

/**
 * S7 wiring (`docs/plans/S7-gpu-lane-queue.md`): which processes queue their
 * inference, and that LLMModule actually picks the dispatcher up.
 */
describe('GpuLaneModule (S7)', () => {
  const env = process.env.GPU_LANE_QUEUE_ENABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.GPU_LANE_QUEUE_ENABLED;
    else process.env.GPU_LANE_QUEUE_ENABLED = env;
  });

  it('binds nothing unless explicitly enabled — inert by default', () => {
    delete process.env.GPU_LANE_QUEUE_ENABLED;
    expect(GpuLaneModule.forRoot().providers ?? []).toEqual([]);

    process.env.GPU_LANE_QUEUE_ENABLED = '1'; // only the literal "true"
    expect(GpuLaneModule.forRoot().providers ?? []).toEqual([]);
  });

  it('binds the dispatcher when enabled', () => {
    process.env.GPU_LANE_QUEUE_ENABLED = 'true';
    expect(GpuLaneModule.forRoot().exports).toEqual([GPU_LANE_DISPATCHER]);
  });

  it('parses its settings strictly', () => {
    expect(positiveInt('3', 1)).toBe(3);
    expect(positiveInt(undefined, 1)).toBe(1);
    expect(positiveInt('0', 1)).toBe(1);
    expect(positiveInt('-2', 1)).toBe(1);
    expect(positiveInt('lots', 7)).toBe(7);
  });
});

describe('LLMModule + a globally bound dispatcher (S7)', () => {
  const lane = async (
    dispatcher?: IGpuLaneDispatcher,
    token = 'LLM_ANALYSIS_PROVIDER',
    observer?: { observe: jest.Mock; increment: jest.Mock },
  ) => {
    const bound = [
      ...(dispatcher
        ? [{ provide: GPU_LANE_DISPATCHER, useValue: dispatcher }]
        : []),
      ...(observer ? [{ provide: METRICS_OBSERVER, useValue: observer }] : []),
    ];
    @Global()
    @Module({
      providers: bound,
      exports: bound.map((b) => b.provide),
    })
    class DispatcherModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DispatcherModule,
        LLMModule,
      ],
    }).compile();
    return moduleRef.get<ILLMProvider>(token);
  };
  const fakeDispatcher = () => ({
    register: jest.fn(),
    generate: jest.fn().mockResolvedValue({ text: 'queued' }),
  });

  it("routes a lane's generate through the dispatcher a worker binds", async () => {
    // Resolved inside LLMModule's own scope: only a GLOBAL binding is visible
    // there, which is why GpuLaneModule is @Global.
    const dispatcher = fakeDispatcher();
    const provider = await lane(dispatcher);

    await expect(provider.generate('P')).resolves.toEqual({ text: 'queued' });
    expect(dispatcher.generate).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'analysis', prompt: 'P' }),
    );
    // What lets this process's consumer run the job: it registered the lane.
    expect(dispatcher.register).toHaveBeenCalledWith(
      'analysis',
      expect.objectContaining({
        url: expect.any(String),
        model: expect.any(String),
      }),
    );
  });

  it('routes the ingestion lane too, under its own name', async () => {
    const dispatcher = fakeDispatcher();
    const provider = await lane(dispatcher, 'LLM_INGESTION_PROVIDER');

    await provider.generate('I');

    expect(dispatcher.generate).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'ingestion', prompt: 'I' }),
    );
    expect(dispatcher.register).toHaveBeenCalledWith(
      'ingestion',
      expect.any(Object),
    );
  });

  it('measures around the queue, so the llm stage includes the wait', async () => {
    // Metrics inside the queue wrapper would measure only the direct provider,
    // which a queued call never reaches: a worker's inference would vanish
    // from Gate 0's accounting.
    const dispatcher = fakeDispatcher();
    dispatcher.generate.mockResolvedValue({
      text: 'queued',
      tokensOut: 5,
      phases: { decodeSeconds: 2 },
    });
    const observer = { observe: jest.fn(), increment: jest.fn() };
    const provider = await lane(dispatcher, 'LLM_ANALYSIS_PROVIDER', observer);

    await provider.generate('P');

    expect(observer.observe).toHaveBeenCalledWith(
      LlmMetric.RequestDurationSeconds,
      2,
      expect.objectContaining({ lane: 'analysis', phase: 'decode' }),
    );
  });

  it('builds a direct provider when nothing is bound — every API process', async () => {
    const provider = await lane(undefined);

    expect(provider.constructor.name).toBe('OllamaLLMProvider');
  });
});

describe('who binds the lane queue (S7)', () => {
  /**
   * The process decides batch vs interactive: an API process that imported
   * GpuLaneModule would put citizens' RAG questions behind the backlog —
   * exactly what S7 exists to stop. Pinned by reading source.
   */
  const SRC = join(__dirname, '..', '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
    });

  it('is imported by the three worker modules and nothing else', () => {
    const importers = files(SRC)
      .filter((f) => readFileSync(f, 'utf8').includes('GpuLaneModule.forRoot('))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .sort();

    expect(importers).toEqual([
      'apps/workers/llm-rerank-worker/src/llm-rerank-worker.module.ts',
      'apps/workers/region-worker/src/region-worker.module.ts',
      'apps/workers/structural-analysis-worker/src/structural-analysis-worker.module.ts',
    ]);
  });
});
