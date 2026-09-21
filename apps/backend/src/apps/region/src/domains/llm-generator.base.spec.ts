import { Test } from '@nestjs/testing';
import type { ILLMProvider } from '@opuspopuli/common';

import {
  LlmGeneratorBase,
  UNKNOWN_MODEL_DIGEST,
  type AiOutputProvenance,
} from './llm-generator.base';

/**
 * The base class is where AI-output attribution is enforced (#1281).
 *
 * #1149 added `outputProvenance()` as a helper, and opt-in drifted within
 * three months: five of six generators called it while proposition-analysis
 * rebuilt the same fields inline, so a change to the attribution set would
 * have reached five of them. These tests pin the contract itself rather than
 * any one generator's use of it.
 */
class ProbeGenerator extends LlmGeneratorBase {
  async probe(): Promise<AiOutputProvenance> {
    return this.outputProvenance({ promptHash: 'h', promptVersion: 'v1' });
  }

  async probeWith(): Promise<Record<string, unknown>> {
    return this.withProvenance(
      { body: 'text' },
      { promptHash: 'h', promptVersion: 'v1' },
      (p) => ({
        thingPromptHash: p.promptHash,
        thingPromptVersion: p.promptVersion,
        thingLlmModel: p.llmModel,
        thingLlmDigest: p.llmModelDigest,
      }),
    );
  }
}

const llmStub = (over: Partial<ILLMProvider> = {}): ILLMProvider =>
  ({
    getName: () => 'stub',
    getModelName: () => 'stub-model:1b',
    getModelDigest: () => Promise.resolve('abc123'),
    ...over,
  }) as unknown as ILLMProvider;

async function build(llm?: ILLMProvider): Promise<ProbeGenerator> {
  const mod = await Test.createTestingModule({
    providers: [
      ProbeGenerator,
      ...(llm ? [{ provide: 'LLM_ANALYSIS_PROVIDER', useValue: llm }] : []),
    ],
  }).compile();
  return mod.get(ProbeGenerator);
}

describe('LlmGeneratorBase provenance (#1281)', () => {
  it('carries the full attribution set, digest included', async () => {
    const provenance = await (await build(llmStub())).probe();

    expect(provenance).toEqual({
      promptHash: 'h',
      promptVersion: 'v1',
      llmModel: 'stub-model:1b',
      llmModelDigest: 'abc123',
    });
  });

  it('records an unresolvable digest as "unknown", never blank', async () => {
    // "We could not determine it" and "we never asked" are different claims.
    // Omitting the field would make them indistinguishable after the fact.
    const provenance = await (
      await build(llmStub({ getModelDigest: () => Promise.resolve(undefined) }))
    ).probe();

    expect(provenance.llmModelDigest).toBe(UNKNOWN_MODEL_DIGEST);
    expect(provenance.llmModelDigest).not.toBe('');
  });

  it('still produces a complete record with no provider wired', async () => {
    // A generator constructed without an LLM must not emit a half-filled
    // provenance object that looks like a successful attribution.
    const provenance = await (await build()).probe();

    expect(provenance.llmModel).toBeNull();
    expect(provenance.llmModelDigest).toBe(UNKNOWN_MODEL_DIGEST);
  });

  it('withProvenance merges the payload with mapped attribution columns', async () => {
    // The write path: a generator maps provenance onto its own prefixed
    // columns, because a table carrying several AI outputs must say WHICH
    // output a hash attributes.
    const row = await (await build(llmStub())).probeWith();

    expect(row).toEqual({
      body: 'text',
      thingPromptHash: 'h',
      thingPromptVersion: 'v1',
      thingLlmModel: 'stub-model:1b',
      thingLlmDigest: 'abc123',
    });
  });

  it('resolves the digest per call so a provider can cache it, not the base', async () => {
    // Caching belongs in the provider (one HTTP round-trip per process); the
    // base must not memoise a value it does not own.
    const getModelDigest = jest.fn().mockResolvedValue('abc123');
    const gen = await build(llmStub({ getModelDigest }));

    await gen.probe();
    await gen.probe();

    expect(getModelDigest).toHaveBeenCalledTimes(2);
  });
});
