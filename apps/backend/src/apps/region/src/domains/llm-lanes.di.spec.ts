import { Inject, Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { ILLMProvider } from '@opuspopuli/common';
import { llmConfig } from '@opuspopuli/config-provider';
import { LLMModule } from '@opuspopuli/llm-provider';

/**
 * The two inference lanes, resolved through Nest rather than reasoned about
 * (roadmap §6.4).
 *
 * Analysis and ingestion are different jobs. Analysis is accuracy-bound —
 * copy a passage verbatim, decline when the source does not support the
 * claim — and `olmo-3.1:32b-instruct` measured 57% claim anchoring against
 * the 7B's 28%, at ~550 s/measure. Ingestion is throughput-bound structured
 * extraction across far more documents, where `olmo-3:7b-instruct` returned
 * 10/10 valid JSON at ~52 s. One pin spends the large model's wall clock
 * where it buys nothing.
 *
 * Boots the module rather than calling the factory, for the reason
 * `source-store-metrics.di.spec.ts` exists: a provider registered where the
 * thing injecting it cannot see it passes every test that constructs the
 * class itself. Three failures in this milestone were exactly that.
 */
/**
 * A consumer that injects the lanes, exactly as the real services do.
 *
 * Resolving the tokens straight off the testing module proves nothing: Nest's
 * `get()` reaches providers of imported modules whether or not they are
 * EXPORTED, so such a test passes with the export removed — verified by
 * reintroduction. Injecting through a separate module is what crosses the
 * export boundary, and crossing it is the thing #1278 got wrong.
 */
@Injectable()
class LaneConsumer {
  constructor(
    @Inject('LLM_ANALYSIS_PROVIDER') readonly analysis: ILLMProvider,
    @Inject('LLM_INGESTION_PROVIDER') readonly ingestion: ILLMProvider,
  ) {}
}

@Module({ imports: [LLMModule], providers: [LaneConsumer] })
class ConsumerModule {}

describe('LLM inference lanes (roadmap §6.4)', () => {
  const ENV = process.env;

  beforeEach(() => {
    process.env = { ...ENV };
    for (const key of [
      'LLM_MODEL',
      'LLM_URL',
      'LLM_OLLAMA_MODEL',
      'LLM_OLLAMA_URL',
      'LLM_INGESTION_MODEL',
      'LLM_INGESTION_URL',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = ENV;
  });

  async function lanes(): Promise<LaneConsumer> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ load: [llmConfig], ignoreEnvFile: true }),
        ConsumerModule,
      ],
    }).compile();

    // Through the consumer, so the token must have crossed the export
    // boundary rather than merely existing inside LLMModule.
    return moduleRef.get(LaneConsumer);
  }

  it('resolves both lanes into a consumer that injects them', async () => {
    const consumer = await lanes();

    // A token that is provided but not exported cannot be injected across a
    // module boundary: the consumer refuses to construct and the container
    // never becomes healthy (#1278).
    expect(consumer.analysis).toBeDefined();
    expect(consumer.ingestion).toBeDefined();
  });

  it('is inert until ingestion is configured', async () => {
    process.env.LLM_MODEL = 'olmo-3.1:32b-instruct';

    const { analysis, ingestion } = await lanes();

    // A deployment that does not use the split gets exactly the provider it
    // had before, so carrying it costs nothing and rolling it out is safe.
    expect(analysis.getModelName()).toBe('olmo-3.1:32b-instruct');
    expect(ingestion.getModelName()).toBe('olmo-3.1:32b-instruct');
  });

  it('puts the lanes on different models when configured', async () => {
    process.env.LLM_MODEL = 'olmo-3.1:32b-instruct';
    process.env.LLM_INGESTION_MODEL = 'olmo-3:7b-instruct';

    const { analysis, ingestion } = await lanes();

    expect(analysis.getModelName()).toBe('olmo-3.1:32b-instruct');
    expect(ingestion.getModelName()).toBe('olmo-3:7b-instruct');
  });

  it('warns when ingestion names a host but not a model', async () => {
    process.env.LLM_MODEL = 'olmo-3.1:32b-instruct';
    process.env.LLM_INGESTION_URL = 'http://mini:11434';

    // Captured off the streams rather than by spying on `Logger.prototype`.
    // The logger lives inside `@opuspopuli/llm-provider`, which resolves its
    // OWN `@nestjs/common` in the pnpm workspace — so the prototype patched
    // here is a different object and the spy silently observes nothing. What
    // an operator actually sees is what is worth asserting anyway.
    const written: string[] = [];
    const capture = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    const err = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(capture as never);
    const out = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(capture as never);

    const consumer = await lanes();

    err.mockRestore();
    out.mockRestore();

    // Pointing ingestion at a second host without naming its model sends the
    // ANALYSIS model there — a 32B at ~21.4GB aimed at a machine chosen for a
    // 7B. That surfaces as a pull error or an OOM rather than as the
    // misconfiguration it is, so it is said plainly at boot.
    expect(consumer.ingestion.getModelName()).toBe('olmo-3.1:32b-instruct');
    expect(written.some((line) => line.includes('LLM_INGESTION_MODEL'))).toBe(
      true,
    );
  });

  it('inherits from the ollama-specific variable, not only LLM_MODEL', async () => {
    process.env.LLM_OLLAMA_MODEL = 'olmo-3.1:32b-instruct';

    const { ingestion } = await lanes();

    // A deployment configured the ollama-specific way would otherwise fall
    // all the way through to the "mistral" default — silently running
    // ingestion on a model nobody chose.
    expect(ingestion.getModelName()).toBe('olmo-3.1:32b-instruct');
  });
});

/**
 * The URL fallback chain, tested at the config rather than the provider.
 *
 * `OllamaLLMProvider` keeps its config private and exposes no endpoint
 * accessor, so the resolved URL is only observable here. It matters because
 * the lanes are meant to end up on different machines — 7B on the Mini, 32B
 * on the Studio — and moving them apart should be a config change rather than
 * another code change.
 */
describe('llmConfig URL resolution', () => {
  const ENV = process.env;

  beforeEach(() => {
    process.env = { ...ENV };
    for (const key of [
      'LLM_URL',
      'LLM_OLLAMA_URL',
      'LLM_INGESTION_URL',
      'LLM_MODEL',
      'LLM_INGESTION_MODEL',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = ENV;
  });

  it('shares one endpoint until ingestion names its own', () => {
    process.env.LLM_URL = 'http://studio:11434';

    const cfg = llmConfig();

    // Both models on one host is where this starts.
    expect(cfg.ollama.url).toBe('http://studio:11434');
    expect(cfg.ingestion.url).toBe('http://studio:11434');
  });

  it('lets the lanes live on different hosts', () => {
    process.env.LLM_URL = 'http://studio:11434';
    process.env.LLM_INGESTION_URL = 'http://mini:11434';

    const cfg = llmConfig();

    expect(cfg.ollama.url).toBe('http://studio:11434');
    expect(cfg.ingestion.url).toBe('http://mini:11434');
  });
});
