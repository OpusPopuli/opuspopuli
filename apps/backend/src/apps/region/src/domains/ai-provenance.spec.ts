import { buildAiProvenance, declaredOrigin } from './ai-provenance';
import { AiProvenanceKind } from './models/ai-provenance.model';

const generatedAt = new Date('2026-11-01T12:00:00Z');
const fetchedAt = new Date('2026-10-30T08:00:00Z');

/** A row with every provenance column recorded under `prefix`. */
function recorded(prefix: string): Record<string, unknown> {
  return {
    [`${prefix}PromptHash`]: 'd8cec07f'.padEnd(64, '0'),
    [`${prefix}PromptVersion`]: 'v4',
    [`${prefix}LlmModel`]: 'nemotron-3.5-lightning:30b-a3b',
    [`${prefix}LlmDigest`]: 'e7a64ff15fb174c42b4f',
    [`${prefix}GeneratedAt`]: generatedAt,
    [`${prefix}SourceHash`]: 'ab'.repeat(32),
  };
}

describe('buildAiProvenance', () => {
  it.each([null, undefined])(
    'returns no receipt when the output is %s',
    (output) => {
      expect(buildAiProvenance(recorded('analysis'), 'analysis', output)).toBe(
        undefined,
      );
    },
  );

  it('gives a receipt for an output that is present but empty', () => {
    expect(buildAiProvenance(recorded('summary'), 'summary', '')?.kind).toBe(
      AiProvenanceKind.AI,
    );
  });

  it('reads every field from the prefixed columns, with the source', () => {
    expect(
      buildAiProvenance(recorded('analysis'), 'analysis', 'text', {
        sourceUrl: 'https://example.gov/prop-1.pdf',
        sourceFetchedAt: fetchedAt,
      }),
    ).toEqual({
      kind: AiProvenanceKind.AI,
      promptHash: 'd8cec07f'.padEnd(64, '0'),
      promptVersion: 'v4',
      llmModel: 'nemotron-3.5-lightning:30b-a3b',
      llmDigest: 'e7a64ff15fb174c42b4f',
      generatedAt,
      sourceUrl: 'https://example.gov/prop-1.pdf',
      sourceFetchedAt: fetchedAt,
      sourcePublishedAt: undefined,
    });
  });

  it('reads only its own prefix', () => {
    const row = { ...recorded('bio'), activitySummaryPromptHash: null };
    expect(buildAiProvenance(row, 'activitySummary', 'text')).toEqual({
      kind: AiProvenanceKind.AI,
      promptHash: undefined,
      promptVersion: undefined,
      llmModel: undefined,
      llmDigest: undefined,
      generatedAt: undefined,
      sourceUrl: undefined,
      sourceFetchedAt: undefined,
      sourcePublishedAt: undefined,
    });
  });

  it('keeps an AI output with nothing recorded as AI, not "no model used"', () => {
    // 4,239 bill summaries on UAT predate recording: they ARE model output.
    const receipt = buildAiProvenance(
      { aiSummaryPromptHash: null, aiSummaryGeneratedAt: null },
      'aiSummary',
      'text',
    );
    expect(receipt?.kind).toBe(AiProvenanceKind.AI);
    expect(receipt?.promptHash).toBeUndefined();
  });

  describe('deterministic text', () => {
    const deterministic = {
      committeesSummaryPromptHash: null,
      committeesSummaryLlmModel: null,
      committeesSummarySourceHash: 'ab'.repeat(32),
      committeesSummaryGeneratedAt: generatedAt,
    };

    it('is told apart by a source hash with no prompt hash', () => {
      expect(
        buildAiProvenance(deterministic, 'committeesSummary', 'text', {
          canBeDeterministic: true,
        }),
      ).toEqual({
        kind: AiProvenanceKind.DETERMINISTIC,
        generatedAt,
        sourceUrl: undefined,
        sourceFetchedAt: undefined,
        sourcePublishedAt: undefined,
      });
    });

    it('only on a surface that has a deterministic path', () => {
      expect(
        buildAiProvenance(deterministic, 'committeesSummary', 'text')?.kind,
      ).toBe(AiProvenanceKind.AI);
    });

    it('is not inferred when nothing at all was recorded', () => {
      expect(
        buildAiProvenance(
          {
            committeesSummaryPromptHash: null,
            committeesSummarySourceHash: null,
          },
          'committeesSummary',
          'text',
          { canBeDeterministic: true },
        )?.kind,
      ).toBe(AiProvenanceKind.AI);
    });
  });

  it.each([
    ['manual' as const, AiProvenanceKind.MANUAL],
    ['scraped' as const, AiProvenanceKind.SCRAPED],
  ])(
    'never attributes %s text to a model, even when stale columns remain',
    (declared, kind) => {
      // A bio re-scraped after an AI run still holds that run's columns.
      expect(
        buildAiProvenance(recorded('bio'), 'bio', 'text', {
          declared,
          sourceUrl: 'https://example.gov/member',
        }),
      ).toEqual({
        kind,
        sourceUrl: 'https://example.gov/member',
        sourceFetchedAt: undefined,
        sourcePublishedAt: undefined,
      });
    },
  );

  it('treats a declared AI origin like an undeclared one', () => {
    expect(
      buildAiProvenance(recorded('bio'), 'bio', 'text', { declared: 'ai' })
        ?.kind,
    ).toBe(AiProvenanceKind.AI);
  });

  it('reads null source fields as absent', () => {
    expect(
      buildAiProvenance(recorded('summary'), 'summary', 'text', {
        sourceUrl: null,
        sourceFetchedAt: null,
        sourcePublishedAt: null,
      }),
    ).toMatchObject({
      sourceUrl: undefined,
      sourceFetchedAt: undefined,
      sourcePublishedAt: undefined,
    });
  });
});

describe('declaredOrigin', () => {
  const allowed = { 'ai-generated': 'ai', manual: 'manual' } as const;

  it.each([
    ['ai-generated', 'ai'],
    ['manual', 'manual'],
    ['legacy-import', 'unrecognised'],
    ['', 'unrecognised'],
    [null, 'unrecognised'],
    [undefined, 'unrecognised'],
  ])('maps %p to %p', (value, expected) => {
    expect(declaredOrigin(value, allowed)).toBe(expected);
  });
});

describe('an unrecognised origin', () => {
  it('is UNKNOWN when nothing shows a model wrote it', () => {
    expect(
      buildAiProvenance({ bioPromptHash: null }, 'bio', 'text', {
        declared: 'unrecognised',
        sourceUrl: 'https://example.gov/member',
      }),
    ).toEqual({
      kind: AiProvenanceKind.UNKNOWN,
      sourceUrl: 'https://example.gov/member',
    });
  });

  it('is AI when a recorded prompt hash shows a model wrote it', () => {
    expect(
      buildAiProvenance(recorded('bio'), 'bio', 'text', {
        declared: 'unrecognised',
      })?.kind,
    ).toBe(AiProvenanceKind.AI);
  });
});
