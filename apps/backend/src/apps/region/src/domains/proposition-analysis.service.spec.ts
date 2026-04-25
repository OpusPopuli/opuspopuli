import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { PropositionAnalysisService } from './proposition-analysis.service';

/**
 * The full text used as the source for analysis in tests. Crafted so the
 * "Findings" and "Operative Provisions" headings appear at predictable
 * char offsets (0 and ~100 respectively) — this lets us verify the
 * normalizer snaps section starts to those positions even when the LLM
 * returns garbage offsets.
 */
const FULL_TEXT = [
  'Findings',
  'and Declarations.',
  'The legislature finds (a) X (b) Y (c) Z.', //
  'Operative Provisions',
  'shall consist of a single question.',
  'A vacancy shall be filled.',
  'Severability',
  'remain in full force and effect.',
].join(' ');

const PROMPT_HASH = 'hash-v1';

const validPayload = JSON.stringify({
  analysisSummary: 'Plain language summary of what the measure does.',
  keyProvisions: ['Raises tax', 'Phases over three years'],
  fiscalImpact: 'Estimated $X per year',
  yesOutcome: 'A yes vote means change.',
  noOutcome: 'A no vote means status quo.',
  existingVsProposed: { current: 'Today', proposed: 'Tomorrow' },
  analysisSections: [
    // Heading exists in FULL_TEXT so the normalizer should snap startOffset to it.
    { heading: 'Findings', startOffset: 999, endOffset: 30 },
    { heading: 'Operative Provisions', startOffset: 999, endOffset: 999 },
    { heading: 'Severability', startOffset: 999, endOffset: 999 },
  ],
  analysisClaims: [
    {
      claim: 'X applies',
      field: 'keyProvisions',
      sourceStart: 0,
      sourceEnd: 50,
      confidence: 'high',
    },
    // Inverted offsets — the normalizer should drop this claim.
    {
      claim: 'should be dropped',
      field: 'keyProvisions',
      sourceStart: 60,
      sourceEnd: 60,
      confidence: 'low',
    },
  ],
});

interface PropRow {
  id: string;
  externalId: string;
  title: string;
  fullText: string | null;
  analysisPromptHash: string | null;
  analysisGeneratedAt: Date | null;
  updatedAt: Date;
  deletedAt?: Date | null;
}

const baseProp = (overrides: Partial<PropRow> = {}): PropRow => ({
  id: 'prop-1',
  externalId: 'SCA 1',
  title: 'Test measure',
  fullText: FULL_TEXT,
  analysisPromptHash: null,
  analysisGeneratedAt: null,
  updatedAt: new Date('2026-04-20T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

describe('PropositionAnalysisService', () => {
  async function buildService(
    opts: {
      withDeps?: boolean;
      withDb?: boolean;
      configValues?: Record<string, string | undefined>;
      findUnique?: PropRow | null;
      findMany?: PropRow[];
      promptHash?: string;
      llmText?: string;
      llmThrows?: Error;
    } = {},
  ) {
    const {
      withDeps = true,
      withDb = true,
      configValues = {},
      findUnique = baseProp(),
      findMany = [],
      promptHash = PROMPT_HASH,
      llmText = validPayload,
      llmThrows,
    } = opts;

    const mockPromptClient = createMock<PromptClientService>();
    mockPromptClient.getDocumentAnalysisPrompt.mockResolvedValue({
      promptText: 'built prompt',
      promptHash,
      promptVersion: '1.0.0',
    });
    mockPromptClient.getPromptHash.mockResolvedValue(promptHash);

    const mockLlm = {
      generate: jest.fn(async () => {
        if (llmThrows) throw llmThrows;
        return { text: llmText } as Awaited<
          ReturnType<ILLMProvider['generate']>
        >;
      }),
    } as unknown as jest.Mocked<ILLMProvider>;

    const mockConfig = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    const mockDb = {
      proposition: {
        findUnique: jest.fn().mockResolvedValue(findUnique),
        findMany: jest.fn().mockResolvedValue(findMany),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as DbService;

    const providers: unknown[] = [PropositionAnalysisService];
    if (withDeps) {
      providers.push(
        { provide: ConfigService, useValue: mockConfig },
        { provide: PromptClientService, useValue: mockPromptClient },
        { provide: 'LLM_PROVIDER', useValue: mockLlm },
      );
    }
    if (withDb) {
      providers.push({ provide: DbService, useValue: mockDb });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(PropositionAnalysisService),
      promptClient: mockPromptClient,
      llm: mockLlm,
      db: mockDb as DbService & {
        proposition: {
          findUnique: jest.Mock;
          findMany: jest.Mock;
          update: jest.Mock;
        };
      },
    };
  }

  describe('when dependencies are unavailable', () => {
    it('returns false from generate when prompt client / llm / db are missing', async () => {
      const built = await buildService({ withDeps: false, withDb: false });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
    });

    it('returns silently from generateMissing when prompt client / llm / db are missing', async () => {
      const built = await buildService({ withDeps: false, withDb: false });
      await expect(built.service.generateMissing()).resolves.toBeUndefined();
    });
  });

  describe('generate(id)', () => {
    it('returns false when proposition is not found', async () => {
      const built = await buildService({ findUnique: null });
      await expect(built.service.generate('missing')).resolves.toBe(false);
      expect(built.db.proposition.update).not.toHaveBeenCalled();
    });

    it('returns false when fullText is empty', async () => {
      const built = await buildService({
        findUnique: baseProp({ fullText: '' }),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.llm.generate).not.toHaveBeenCalled();
    });

    it('returns false when fullText is null', async () => {
      const built = await buildService({
        findUnique: baseProp({ fullText: null }),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.llm.generate).not.toHaveBeenCalled();
    });

    it('skips when analysis is current and force is false', async () => {
      const generatedAt = new Date('2026-04-21T00:00:00Z');
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: generatedAt,
          analysisPromptHash: PROMPT_HASH,
          updatedAt: new Date('2026-04-20T00:00:00Z'),
        }),
      });

      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.llm.generate).not.toHaveBeenCalled();
    });

    it('regenerates when force is true even if analysis is current', async () => {
      const generatedAt = new Date('2026-04-21T00:00:00Z');
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: generatedAt,
          analysisPromptHash: PROMPT_HASH,
          updatedAt: new Date('2026-04-20T00:00:00Z'),
        }),
      });

      await expect(built.service.generate('prop-1', true)).resolves.toBe(true);
      expect(built.llm.generate).toHaveBeenCalledTimes(1);
      expect(built.db.proposition.update).toHaveBeenCalledTimes(1);
    });

    it('regenerates when prompt hash has changed', async () => {
      const generatedAt = new Date('2026-04-21T00:00:00Z');
      const built = await buildService({
        promptHash: 'hash-v2-changed',
        findUnique: baseProp({
          analysisGeneratedAt: generatedAt,
          analysisPromptHash: 'hash-v1',
          updatedAt: new Date('2026-04-20T00:00:00Z'),
        }),
      });

      await expect(built.service.generate('prop-1')).resolves.toBe(true);
    });

    it('regenerates when fullText has been touched after the previous analysis', async () => {
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: new Date('2026-04-19T00:00:00Z'),
          analysisPromptHash: PROMPT_HASH,
          // updatedAt > analysisGeneratedAt → stale
          updatedAt: new Date('2026-04-21T00:00:00Z'),
        }),
      });

      await expect(built.service.generate('prop-1')).resolves.toBe(true);
    });

    it('treats analysis as stale when prompt-hash lookup throws', async () => {
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: new Date('2026-04-21T00:00:00Z'),
          analysisPromptHash: PROMPT_HASH,
          updatedAt: new Date('2026-04-20T00:00:00Z'),
        }),
      });
      built.promptClient.getPromptHash.mockRejectedValueOnce(
        new Error('prompt service down'),
      );

      await expect(built.service.generate('prop-1')).resolves.toBe(true);
    });

    it('persists the parsed payload on success', async () => {
      const built = await buildService();
      await expect(built.service.generate('prop-1')).resolves.toBe(true);

      expect(built.db.proposition.update).toHaveBeenCalledTimes(1);
      const update = built.db.proposition.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'prop-1' });
      expect(update.data.analysisSummary).toBe(
        'Plain language summary of what the measure does.',
      );
      expect(update.data.keyProvisions).toEqual([
        'Raises tax',
        'Phases over three years',
      ]);
      expect(update.data.analysisSource).toBe('ai-generated');
      expect(update.data.analysisPromptHash).toBe(PROMPT_HASH);
      expect(update.data.analysisGeneratedAt).toBeInstanceOf(Date);
    });

    it('snaps section startOffsets to the verbatim heading position in fullText', async () => {
      const built = await buildService();
      await built.service.generate('prop-1');

      const sections = built.db.proposition.update.mock.calls[0][0].data
        .analysisSections as Array<{
        heading: string;
        startOffset: number;
        endOffset: number;
      }>;

      // Findings should snap to offset 0 (or be forced to 0 because it's first).
      expect(sections[0].startOffset).toBe(0);
      // The "Operative Provisions" heading is in FULL_TEXT — startOffset should
      // match the actual indexOf, not the LLM's bogus value.
      const operativeIdx = FULL_TEXT.indexOf('Operative Provisions');
      expect(operativeIdx).toBeGreaterThan(0);
      expect(sections[1].startOffset).toBe(operativeIdx);
      // No inter-section gaps — each end matches the next start.
      for (let i = 0; i < sections.length - 1; i++) {
        expect(sections[i].endOffset).toBe(sections[i + 1].startOffset);
      }
      // Last section ends at fullText.length.
      expect(sections[sections.length - 1].endOffset).toBe(FULL_TEXT.length);
    });

    it('drops claims with inverted offsets', async () => {
      const built = await buildService();
      await built.service.generate('prop-1');

      const claims = built.db.proposition.update.mock.calls[0][0].data
        .analysisClaims as Array<unknown>;
      // The valid claim survives; the inverted (start>=end) claim is dropped.
      expect(claims).toHaveLength(1);
    });

    it('returns false and swallows errors when the LLM throws', async () => {
      const built = await buildService({
        llmThrows: new Error('LLM boom'),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.db.proposition.update).not.toHaveBeenCalled();
    });

    it('returns false when the LLM emits unparseable JSON', async () => {
      const built = await buildService({ llmText: 'not even close to json' });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.db.proposition.update).not.toHaveBeenCalled();
    });

    it('returns false when the parsed payload has no summary', async () => {
      const built = await buildService({
        llmText: JSON.stringify({
          analysisSummary: '   ',
          keyProvisions: ['x'],
        }),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.db.proposition.update).not.toHaveBeenCalled();
    });

    it('defaults missing fields rather than writing undefined', async () => {
      const built = await buildService({
        llmText: JSON.stringify({
          analysisSummary: 'Brief summary.',
          // Everything else missing or wrong shape.
          keyProvisions: 'not an array',
          analysisSections: [],
          analysisClaims: [],
        }),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(true);
      const data = built.db.proposition.update.mock.calls[0][0].data;
      expect(data.keyProvisions).toEqual([]);
      expect(data.fiscalImpact).toBe('');
      expect(data.yesOutcome).toBe('');
      expect(data.noOutcome).toBe('');
      expect(data.existingVsProposed).toEqual({ current: '', proposed: '' });
      expect(data.analysisSections).toEqual([]);
      expect(data.analysisClaims).toEqual([]);
    });
  });

  describe('generateMissing', () => {
    it('does nothing when no propositions are pending', async () => {
      const built = await buildService({ findMany: [] });
      await built.service.generateMissing();
      expect(built.llm.generate).not.toHaveBeenCalled();
      expect(built.db.proposition.update).not.toHaveBeenCalled();
    });

    it('processes every pending proposition and persists each', async () => {
      const rows = [
        baseProp({ id: 'p1', externalId: 'SCA 1' }),
        baseProp({ id: 'p2', externalId: 'ACA 13' }),
      ];
      const built = await buildService({ findMany: rows });

      // generateMissing reads pending rows from findMany; each row then
      // calls tryGenerateAndPersist which re-fetches via findUnique. Make
      // findUnique return the matching row by id.
      built.db.proposition.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
      );

      await built.service.generateMissing();
      expect(built.llm.generate).toHaveBeenCalledTimes(2);
      expect(built.db.proposition.update).toHaveBeenCalledTimes(2);
    });

    it('respects the maxPropsOverride cap when provided', async () => {
      const built = await buildService({
        findMany: [baseProp({ id: 'p1' })],
      });

      await built.service.generateMissing(5);

      expect(built.db.proposition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('falls back to the env cap when no override is provided', async () => {
      const built = await buildService({
        findMany: [],
        configValues: { PROPOSITION_ANALYSIS_MAX_PROPS: '3' },
      });

      await built.service.generateMissing();

      expect(built.db.proposition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('runs without a cap when neither override nor env is set', async () => {
      const built = await buildService({ findMany: [] });

      await built.service.generateMissing();

      expect(built.db.proposition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: undefined }),
      );
    });
  });

  describe('config parsing', () => {
    it('uses defaults when env vars are absent', async () => {
      // No assertion on private state; we exercise the constructor
      // path with no config values to cover the env-fallback branches.
      await expect(buildService()).resolves.toBeDefined();
    });

    it('honours non-default PROPOSITION_ANALYSIS_MAX_TOKENS / CONCURRENCY', async () => {
      const built = await buildService({
        configValues: {
          PROPOSITION_ANALYSIS_MAX_TOKENS: '777',
          PROPOSITION_ANALYSIS_CONCURRENCY: '2',
        },
        findMany: [baseProp({ id: 'p1' }), baseProp({ id: 'p2' })],
      });
      built.db.proposition.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          baseProp({ id: where.id }),
      );

      await built.service.generateMissing();

      // maxTokens passed through to the LLM call
      expect(built.llm.generate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTokens: 777 }),
      );
    });

    it('ignores invalid env values and uses defaults', async () => {
      const built = await buildService({
        configValues: {
          PROPOSITION_ANALYSIS_MAX_TOKENS: 'not-a-number',
          PROPOSITION_ANALYSIS_CONCURRENCY: '-1',
          PROPOSITION_ANALYSIS_MAX_PROPS: 'bad',
        },
        findMany: [baseProp({ id: 'p1' })],
      });
      built.db.proposition.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          baseProp({ id: where.id }),
      );

      await built.service.generateMissing();

      // Invalid PROPOSITION_ANALYSIS_MAX_PROPS → undefined cap
      expect(built.db.proposition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: undefined }),
      );
    });
  });
});
