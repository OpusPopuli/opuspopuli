import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { recordClaims } from './claim-recorder';
import {
  PropositionAnalysisService,
  propositionAnalysisConfigHash,
} from './proposition-analysis.service';
import { outputJobId } from './output-lane';

jest.mock('./claim-recorder', () => ({
  recordClaims: jest.fn().mockResolvedValue({ written: 0, byState: {} }),
}));

const recordClaimsMock = recordClaims as jest.MockedFunction<
  typeof recordClaims
>;

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
  analysisSourceTextHash: string | null;
  fullTextHash: string | null;
  analysisGeneratedAt: Date | null;
  analysisLlmDigest: string | null;
  analysisConfigHash: string | null;
  updatedAt: Date;
  deletedAt?: Date | null;
}

/**
 * SHA-256 of FULL_TEXT — what a *current* analysis must carry in
 * `analysisSourceTextHash` (#1279). Kept in the spec rather than imported so
 * the test asserts the value independently of the implementation that
 * produces it; it must also equal the Postgres-generated `full_text_hash`.
 */
const FULL_TEXT_HASH = createHash('sha256')
  .update(FULL_TEXT, 'utf8')
  .digest('hex');

const baseProp = (overrides: Partial<PropRow> = {}): PropRow => ({
  id: 'prop-1',
  externalId: 'SCA 1',
  title: 'Test measure',
  fullText: FULL_TEXT,
  analysisPromptHash: null,
  analysisSourceTextHash: null,
  fullTextHash: FULL_TEXT_HASH,
  analysisGeneratedAt: null,
  analysisLlmDigest: null,
  analysisConfigHash: null,
  updatedAt: new Date('2026-04-20T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

/**
 * A refusal must leave two marks: the row says why, and no analysis field is
 * written. Asserting both together is the point — #1085 was a failure that
 * left neither.
 */
function expectFailureRecorded(
  built: { db: { proposition: { update: jest.Mock } } },
  reason: string,
): void {
  expect(built.db.proposition.update).toHaveBeenCalledTimes(1);
  const data = built.db.proposition.update.mock.calls[0][0].data;
  expect(data.analysisFailureReason).toBe(reason);
  expect(data.analysisFailedAt).toBeInstanceOf(Date);
  expect(data.analysisSummary).toBeUndefined();
  expect(data.analysisGeneratedAt).toBeUndefined();
}

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
      llmFinishReason?: 'stop' | 'length' | 'error';
      llmTokensOut?: number;
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
      llmFinishReason,
      llmTokensOut,
    } = opts;

    const mockPromptClient = createMock<PromptClientService>();
    mockPromptClient.getDocumentAnalysisPrompt.mockResolvedValue({
      promptText: 'built prompt',
      promptHash,
      promptVersion: '1.0.0',
    });
    mockPromptClient.getPromptHash.mockResolvedValue(promptHash);

    const mockLlm = {
      getModelName: jest.fn().mockReturnValue('qwen-test:9b'),
      // #1281: the weights behind the tag, resolved by the provider.
      getModelDigest: jest.fn().mockResolvedValue('stub-digest'),
      generate: jest.fn(async () => {
        if (llmThrows) throw llmThrows;
        return {
          text: llmText,
          finishReason: llmFinishReason,
          tokensOut: llmTokensOut,
        } as Awaited<ReturnType<ILLMProvider['generate']>>;
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        // Prisma field references (#1279). The real client exposes these so a
        // query can compare two COLUMNS — `analysis_source_text_hash` against
        // the Postgres-generated `full_text_hash` — without raw SQL. Shaped
        // like the real thing so a where-clause assertion is meaningful.
        fields: {
          fullTextHash: {
            modelName: 'Proposition',
            name: 'fullTextHash',
            typeName: 'String',
            isList: false,
            isEnum: false,
          },
        },
      },
    } as unknown as DbService;

    const providers: unknown[] = [PropositionAnalysisService];
    if (withDeps) {
      providers.push(
        { provide: ConfigService, useValue: mockConfig },
        { provide: PromptClientService, useValue: mockPromptClient },
        { provide: 'LLM_ANALYSIS_PROVIDER', useValue: mockLlm },
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
          updateMany: jest.Mock;
          count: jest.Mock;
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

  describe('analyseOne (the proposition-analysis job, S4)', () => {
    const current = {
      analysisGeneratedAt: new Date('2026-04-21T00:00:00Z'),
      analysisPromptHash: PROMPT_HASH,
      analysisSourceTextHash: FULL_TEXT_HASH,
      analysisLlmDigest: 'stub-digest',
    };

    it('is created for a first analysis and updated for a re-analysis', async () => {
      const first = await buildService({ findUnique: baseProp() });
      await expect(first.service.analyseOne('prop-1')).resolves.toBe('created');

      const again = await buildService({
        findUnique: baseProp({ ...current, analysisLlmDigest: 'older' }),
      });
      await expect(again.service.analyseOne('prop-1')).resolves.toBe('updated');
    });

    it('is unchanged — no LLM call — when the measure became current after it was queued', async () => {
      const built = await buildService({ findUnique: baseProp(current) });

      await expect(built.service.analyseOne('prop-1')).resolves.toBe(
        'unchanged',
      );
      expect(built.llm.generate).not.toHaveBeenCalled();
    });

    it('throws on a transport failure so the queue retries it — and still records it', async () => {
      const built = await buildService({
        llmThrows: new Error('unexpected EOF'),
      });

      await expect(built.service.analyseOne('prop-1')).rejects.toThrow(
        'llm_error',
      );
      expect(built.db.proposition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ analysisFailureReason: 'llm_error' }),
        }),
      );
    });

    it('returns failed, not a retry, for a deterministic failure', async () => {
      const built = await buildService({ llmText: 'no JSON at all' });

      await expect(built.service.analyseOne('prop-1')).resolves.toBe('failed');
    });

    it('is skipped — not a failure — for a measure that is gone or has no text', async () => {
      // A failure would repeat every run and, five in a row, trip the abort.
      const built = await buildService({ findUnique: null });

      await expect(built.service.analyseOne('missing')).resolves.toBe(
        'skipped',
      );
    });

    it('never selects a measure with empty text', async () => {
      const built = await buildService({ findMany: [] });

      await built.service.stampAndSelectStale();

      const where = built.db.proposition.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { fullText: { not: null } },
        { fullText: { not: '' } },
      ]);
    });
  });

  describe('stampAndSelectStale — the current count (K-P2 skips)', () => {
    it('counts the analysable measures that are NOT stale, beside the stale ones', async () => {
      const built = await buildService({ findMany: [] });
      built.db.proposition.count.mockResolvedValue(69);

      const { current } = await built.service.stampAndSelectStale();

      expect(current).toBe(69);
      const selected = built.db.proposition.findMany.mock.calls[0][0].where;
      const counted = built.db.proposition.count.mock.calls[0][0].where;
      // The complement of the same selection: same analysable filter, and
      // the stale arms negated as a whole.
      expect(counted.AND).toEqual(selected.AND);
      expect(counted.deletedAt).toBeNull();
      expect(counted.NOT).toEqual({ OR: selected.OR });
    });
  });

  describe('the analysis job id (S4)', () => {
    const live = {
      promptHash: PROMPT_HASH,
      modelDigest: 'stub-digest',
      configHash: propositionAnalysisConfigHash(6000),
    };
    const prop = {
      id: '11111111-1111-1111-1111-111111111111',
      fullTextHash: FULL_TEXT_HASH,
    };

    // The id the sync actually queues under: the lane's, over this key.
    const jobId = (l: typeof live | Record<string, unknown>) =>
      outputJobId(
        {
          id: prop.id,
          key: PropositionAnalysisService.analysisKey(prop, l as typeof live),
        },
        'analyse',
      );

    it('is the measure, the stage and the skip key — equal for equal inputs', () => {
      const id = jobId(live);

      expect(id).toMatch(new RegExp(`^${prop.id}__analyse__sk1-[0-9a-f]{64}$`));
      expect(jobId(live)).toBe(id);
      expect(jobId({ ...live, modelDigest: 'other' })).not.toBe(id);
    });

    it('is a one-off id when an axis is unknown — it never collapses', () => {
      const unknown = { ...live, modelDigest: undefined };

      expect(PropositionAnalysisService.analysisKey(prop, unknown)).toBeNull();
      expect(jobId(unknown)).not.toBe(jobId(unknown));
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
          // Current on the SOURCE-TEXT axis too, not just the prompt axis.
          analysisSourceTextHash: FULL_TEXT_HASH,
          // ...and on the model axis (K-P2).
          analysisLlmDigest: 'stub-digest',
          updatedAt: new Date('2026-04-20T00:00:00Z'),
        }),
      });

      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.llm.generate).not.toHaveBeenCalled();
    });

    it('is still current after a sync touched the row — updatedAt is not an axis', async () => {
      // Every sync upsert and every embedding write bump updatedAt, so the
      // old `updatedAt > analysisGeneratedAt` check made every row stale.
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: new Date('2026-04-21T00:00:00Z'),
          analysisPromptHash: PROMPT_HASH,
          analysisSourceTextHash: FULL_TEXT_HASH,
          analysisLlmDigest: 'stub-digest',
          updatedAt: new Date('2026-10-24T00:00:00Z'),
        }),
      });

      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expect(built.llm.generate).not.toHaveBeenCalled();
    });

    it.each([
      ['the model weights changed', { analysisLlmDigest: 'older-digest' }],
      ['the analyzer config changed', { analysisConfigHash: 'other-config' }],
    ])('regenerates when %s (K-P2)', async (_why, axis) => {
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: new Date('2026-04-21T00:00:00Z'),
          analysisPromptHash: PROMPT_HASH,
          analysisSourceTextHash: FULL_TEXT_HASH,
          analysisLlmDigest: 'stub-digest',
          ...axis,
        }),
      });

      await built.service.generate('prop-1');

      expect(built.llm.generate).toHaveBeenCalled();
    });

    describe('source-text staleness (#1279)', () => {
      it('records which text version the analysis was generated against', async () => {
        const built = await buildService({
          findUnique: baseProp({ analysisGeneratedAt: null }),
        });

        await built.service.generate('prop-1');

        const data = built.db.proposition.update.mock.calls[0][0].data;
        expect(data.analysisSourceTextHash).toBe(FULL_TEXT_HASH);
      });

      it('regenerates when fullText changed since the analysis was written', async () => {
        // The failure this exists to stop: sync rewrites fullText in place,
        // and claim offsets — derived by locating a quote (#1212) — silently
        // address different characters with nothing to detect it.
        const built = await buildService({
          findUnique: baseProp({
            analysisGeneratedAt: new Date('2026-04-21T00:00:00Z'),
            analysisPromptHash: PROMPT_HASH,
            analysisSourceTextHash: createHash('sha256')
              .update('the text that WAS analysed', 'utf8')
              .digest('hex'),
            updatedAt: new Date('2026-04-20T00:00:00Z'),
          }),
        });

        await expect(built.service.generate('prop-1')).resolves.toBe(true);
        expect(built.llm.generate).toHaveBeenCalled();
      });

      it('treats a missing source-text hash as stale, not as fresh', async () => {
        // Rows written before this column existed. Unknown must never read as
        // verified — the same fail-closed posture as the prompt axis.
        const built = await buildService({
          findUnique: baseProp({
            analysisGeneratedAt: new Date('2026-04-21T00:00:00Z'),
            analysisPromptHash: PROMPT_HASH,
            analysisSourceTextHash: null,
            updatedAt: new Date('2026-04-20T00:00:00Z'),
          }),
        });

        await expect(built.service.generate('prop-1')).resolves.toBe(true);
      });

      it('computes the same digest Postgres does', () => {
        // Load-bearing invariant. `full_text_hash` is GENERATED ALWAYS AS
        // encode(sha256(full_text::bytea),'hex'); if this diverged from it,
        // every row would compare unequal and regenerate on every run —
        // hours of LLM time, with nothing obviously broken.
        //
        // Golden values measured directly from PostgreSQL 17.6 on
        // 2026-09-17, covering the encodings the corpus actually contains.
        const golden: Array<[string, string]> = [
          [
            'hello',
            '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
          ],
          [
            'SECTION 1. \u201cSmart quotes\u201d \u2014 \u00f1',
            'b4ed5b29ffb05c6cb2b8ac1467f0a38f56f2ea022d31f09fc7ce791f142219e8',
          ],
          [
            '',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          ],
        ];

        for (const [text, expected] of golden) {
          expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(
            expected,
          );
        }
      });
    });

    it('regenerates when force is true even if analysis is current', async () => {
      const generatedAt = new Date('2026-04-21T00:00:00Z');
      const built = await buildService({
        findUnique: baseProp({
          analysisGeneratedAt: generatedAt,
          analysisPromptHash: PROMPT_HASH,
          // Current on the SOURCE-TEXT axis too, not just the prompt axis.
          analysisSourceTextHash: FULL_TEXT_HASH,
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
      // #1149 — version + model join the hash that shipped first.
      expect(update.data.analysisPromptVersion).toBe('1.0.0');
      expect(update.data.analysisLlmModel).toBe('qwen-test:9b');
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

    describe('quote-then-locate contract (#1212)', () => {
      const quoted = (claims: unknown[]): string =>
        JSON.stringify({
          analysisSummary: 'Plain language summary of what the measure does.',
          keyProvisions: ['Raises tax'],
          fiscalImpact: '',
          yesOutcome: 'A yes vote means change.',
          noOutcome: 'A no vote means status quo.',
          existingVsProposed: { current: 'Today', proposed: 'Tomorrow' },
          analysisSections: [],
          analysisClaims: claims,
        });

      const claimsFrom = async (
        llmText: string,
      ): Promise<Array<Record<string, unknown>>> => {
        const built = await buildService({ llmText });
        await built.service.generate('prop-1');
        return built.db.proposition.update.mock.calls[0][0].data
          .analysisClaims as Array<Record<string, unknown>>;
      };

      it('derives offsets from the quote instead of trusting the model', async () => {
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'ballots carry one question',
              field: 'keyProvisions',
              sourceQuote: 'shall consist of a single question.',
              confidence: 'high',
            },
          ]),
        );

        expect(claims).toHaveLength(1);
        expect(claims[0].verified).toBe(true);
        // The offsets must slice the SOURCE back to the quoted passage — that
        // is the whole contract: the model quotes, code locates.
        const start = claims[0].sourceStart as number;
        const end = claims[0].sourceEnd as number;
        expect(FULL_TEXT.slice(start, end)).toBe(
          'shall consist of a single question.',
        );
        expect(claims[0].sourceQuote).toBe(
          'shall consist of a single question.',
        );
      });

      it('tolerates a quote the model reflowed', async () => {
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'ballots carry one question',
              field: 'keyProvisions',
              sourceQuote: 'shall consist of\n   a single question.',
            },
          ]),
        );
        expect(claims).toHaveLength(1);
        expect(claims[0].verified).toBe(true);
      });

      it('drops a claim whose quote is not in the source — fail closed', async () => {
        // A paraphrase is the expected failure of this contract. It must not
        // become a citation: the old contract clamped a bad span into range
        // and rendered it as precise attribution, which is the defect #1212
        // exists to remove.
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'invented',
              field: 'keyProvisions',
              sourceQuote: 'all homework is hereby abolished forthwith',
            },
          ]),
        );
        expect(claims).toHaveLength(0);
      });

      it('drops a quote carrying contact details (#1263)', async () => {
        // A verbatim quote copies whatever it cites, and full_text carries
        // proponent emails/phones/addresses unredacted. Refuse rather than
        // publish them through a new field.
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'contact the proponent',
              field: 'keyProvisions',
              sourceQuote:
                'Questions to jane.doe@example.com or (916) 555-0134',
            },
          ]),
        );
        expect(claims).toHaveLength(0);
      });

      it('drops a quote-less claim when the payload is on the quoted contract', async () => {
        // One template generates the whole payload. A model that ignored the
        // instruction and asserted offsets for one claim must not get a
        // clamped, precise-looking citation via the legacy path.
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'properly quoted',
              field: 'keyProvisions',
              sourceQuote: 'A vacancy shall be filled.',
            },
            {
              claim: 'asserted offsets, no quote',
              field: 'keyProvisions',
              sourceStart: 0,
              sourceEnd: 40,
            },
          ]),
        );
        expect(claims).toHaveLength(1);
        expect(claims[0].claim).toBe('properly quoted');
      });

      it('drops a claim whose own TEXT carries contact details', async () => {
        // The claim is model-written from a source that contains them, so it
        // can restate a phone number even when the quoted span is clean.
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'Proponents may be reached at (916) 555-0134',
              field: 'keyProvisions',
              sourceQuote: 'A vacancy shall be filled.',
            },
          ]),
        );
        expect(claims).toHaveLength(0);
      });

      it('still honours the legacy offsets contract when no quote is present', async () => {
        const claims = await claimsFrom(
          quoted([
            {
              claim: 'legacy claim',
              field: 'keyProvisions',
              sourceStart: 0,
              sourceEnd: 20,
            },
          ]),
        );
        expect(claims).toHaveLength(1);
        expect(claims[0].verified).toBeUndefined();
        expect(claims[0].sourceEnd).toBe(20);
      });
    });

    it('returns false and records the reason when the LLM throws', async () => {
      const built = await buildService({
        llmThrows: new Error('LLM boom'),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expectFailureRecorded(built, 'llm_error');
    });

    it('returns false and records the reason when no JSON comes back', async () => {
      const built = await buildService({ llmText: 'not even close to json' });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expectFailureRecorded(built, 'no_json');
    });

    /**
     * This case used to assert `parse_error`, and it was right to until the
     * JSON repair was wired in: a trailing comma is one of the two
     * malformations civics already recovers from (#1337), and losing an entire
     * proposition analysis to one is the outcome that fix exists to prevent.
     * Here it costs ~38,000 characters of statutory prose and a 32B-model run,
     * because `normalizePayload` refuses a partial salvage.
     */
    it('recovers from a trailing comma rather than failing the analysis', async () => {
      const built = await buildService({
        llmText: '{"analysisSummary": "x",}',
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(true);
    });

    it('recovers from an unescaped quote in a string value', async () => {
      // What statutory prose does to a model: the source quotes something, the
      // model reproduces the inner quotes without escaping them.
      const built = await buildService({
        llmText: '{"analysisSummary": "referred to as a "full check.""}',
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(true);
    });

    it('still records parse_error when no repair applies', async () => {
      // Balanced braces, invalid JSON inside, and neither repair class
      // touches it — a missing value is not a stray quote or a stray comma.
      // The failure path has to survive the repair being added.
      const built = await buildService({
        llmText: '{"analysisSummary": }',
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      expectFailureRecorded(built, 'parse_error');
    });

    /**
     * The failure detail must describe the string the MODEL produced, not the
     * one the repair produced — a post-repair position sends whoever reads the
     * log to a byte offset in a string that was never sent, and the repair
     * inserts characters, so the two offsets are guaranteed to disagree.
     *
     * This fixture is built so both offsets are observable and different:
     *
     *   sent     `..."he said "hi" there"...`  -> SyntaxError at position 30
     *   repaired `..."he said \"hi\" there"...` -> SyntaxError at position 60
     *
     * The unescaped quotes repair cleanly (position 30 goes away), the `1 2`
     * after `confidence` does not, so the analysis still fails — and the
     * surviving defect sits 30 characters later in the repaired string than
     * the original error did. Reporting the wrong one is a silent 30-byte lie.
     */
    it('reports the position of the error the model made, not the repaired one', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      try {
        const built = await buildService({
          llmText:
            '{"analysisSummary": "he said "hi" there", "confidence": 1 2}',
        });
        await expect(built.service.generate('prop-1')).resolves.toBe(false);
        expectFailureRecorded(built, 'parse_error');

        const line = warn.mock.calls
          .map((call) => call[0])
          .filter((arg): arg is string => typeof arg === 'string')
          .find((arg) => arg.includes('reason=parse_error'));
        expect(line).toContain('detail=SyntaxError at position 30');
        expect(line).not.toContain('position 60');
      } finally {
        warn.mockRestore();
      }
    });

    it('returns false and records the reason when the payload has no summary', async () => {
      const built = await buildService({
        llmText: JSON.stringify({
          analysisSummary: '   ',
          keyProvisions: ['x'],
        }),
      });
      await expect(built.service.generate('prop-1')).resolves.toBe(false);
      // The path that wrote nothing at any log level before #1085.
      expectFailureRecorded(built, 'no_summary');
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

    describe('prompt-revision staleness (#1212 S5)', () => {
      // A revised template must actually cause regeneration. Before S5 this
      // selected only rows with no analysis at all, so a prompt change
      // regenerated nothing — while the backfill script's own comment claimed
      // it handled exactly that case.
      it('selects analyses written under a different prompt', async () => {
        const built = await buildService({ findMany: [] });

        await built.service.generateMissing();

        const where = built.db.proposition.findMany.mock.calls[0][0]
          .where as Record<string, unknown>;
        expect(where.OR).toEqual(
          expect.arrayContaining([
            { analysisGeneratedAt: null },
            { analysisPromptHash: null },
            { analysisPromptHash: { not: PROMPT_HASH } },
          ]),
        );
      });

      it('selects analyses written by other weights or another analyzer config (K-P2)', async () => {
        const built = await buildService({ findMany: [] });

        await built.service.generateMissing();

        const where = built.db.proposition.findMany.mock.calls[0][0]
          .where as Record<string, unknown>;
        expect(where.OR).toEqual(
          expect.arrayContaining([
            { analysisLlmDigest: null },
            { analysisLlmDigest: { not: 'stub-digest' } },
            { analysisConfigHash: null },
            {
              analysisConfigHash: {
                not: propositionAnalysisConfigHash(6000),
              },
            },
          ]),
        );
      });

      it('stamps the config hash on current pre-K-P2 analyses instead of regenerating them', async () => {
        // The owner's backfill decision (2026-10-24).
        const built = await buildService({ findMany: [] });

        await built.service.generateMissing();

        expect(built.db.proposition.updateMany).toHaveBeenCalledWith({
          where: {
            analysisConfigHash: null,
            analysisGeneratedAt: { not: null },
          },
          data: { analysisConfigHash: propositionAnalysisConfigHash(6000) },
        });
        // Stamped BEFORE the selection, so the stamped rows are not selected.
        expect(
          built.db.proposition.updateMany.mock.invocationCallOrder[0],
        ).toBeLessThan(
          built.db.proposition.findMany.mock.invocationCallOrder[0],
        );
      });

      it('does not use the model axis when the digest is unknown', async () => {
        // Unknown weights cannot prove a change; regenerating the corpus on a
        // failed digest lookup would be hours of GPU for nothing.
        const built = await buildService({ findMany: [] });
        built.llm.getModelDigest.mockResolvedValueOnce(undefined);

        await built.service.generateMissing();

        const where = built.db.proposition.findMany.mock.calls[0][0].where as {
          OR: Record<string, unknown>[];
        };
        expect(where.OR.some((arm) => 'analysisLlmDigest' in arm)).toBe(false);
        // The backfill still runs: waiting on the digest would re-analyse
        // every legacy row on a run whose lookup failed.
        expect(built.db.proposition.updateMany).toHaveBeenCalled();
      });

      it('records the config hash with every analysis it writes', async () => {
        const built = await buildService({ findMany: [baseProp()] });

        await built.service.generateMissing();

        expect(built.db.proposition.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              analysisConfigHash: propositionAnalysisConfigHash(6000),
            }),
          }),
        );
      });

      it('resolves the live prompt hash once per batch, not once per row', async () => {
        const built = await buildService({
          findMany: [baseProp({ id: 'p1' }), baseProp({ id: 'p2' })],
        });

        await built.service.generateMissing();

        expect(built.promptClient.getPromptHash).toHaveBeenCalledTimes(1);
      });

      it('drops only the PROMPT arms when the hash lookup fails', async () => {
        // Failing open on the prompt axis would regenerate EVERY analysis on
        // every run — hours of LLM time from a transient prompt-service blip.
        // But the source-text axis does not depend on prompt-service at all,
        // so it must keep working: a proposition whose text changed is still
        // stale whether or not the prompt hash could be resolved (#1279).
        const built = await buildService({ findMany: [] });
        built.promptClient.getPromptHash.mockRejectedValueOnce(
          new Error('prompt-service unreachable'),
        );

        await built.service.generateMissing();

        const where = built.db.proposition.findMany.mock.calls[0][0].where as {
          OR: Array<Record<string, unknown>>;
        };
        const serialised = JSON.stringify(where.OR);

        expect(serialised).not.toContain('analysisPromptHash');
        expect(where.OR).toEqual(
          expect.arrayContaining([
            { analysisGeneratedAt: null },
            { analysisSourceTextHash: null },
          ]),
        );
        expect(serialised).toContain('fullTextHash');
      });
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

  describe('reporting a failure (#1085)', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('carries finishReason so truncation is distinguishable from rambling', async () => {
      // The whole reason #1085 could not be diagnosed: an output truncated at
      // maxTokens and a model that ignored the format look identical once the
      // reason is discarded, and they want opposite fixes.
      const built = await buildService({
        llmText: '{"analysisSummary": "cut off mid-',
        llmFinishReason: 'length',
      });

      await built.service.generate('prop-1');

      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('SCA 1');
      expect(line).toContain('finish=length');
      // Named outright rather than left for the reader to infer from the pair.
      expect(line).toContain('reason=truncated');
    });

    it('calls it truncated when the budget was spent, even if the provider says "stop"', async () => {
      // The case that cost #1085 months. Ollama mapped finishReason from
      // `done`, so a response cut off at the token budget reported "stop" and
      // the failure read as a model ignoring its output format. Two measures
      // sat unanalysable in production on that misreading; raising the budget
      // fixed both immediately.
      //
      // The provider is fixed, but older builds omit `done_reason`, so the
      // budget spent is the second, independent signal.
      const built = await buildService({
        configValues: { PROPOSITION_ANALYSIS_MAX_TOKENS: '1000' },
        llmText: 'prose that never opens a JSON object',
        llmFinishReason: 'stop',
        llmTokensOut: 1000,
      });

      await built.service.generate('prop-1');

      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('reason=truncated');
    });

    it('does not cry truncation when the budget was barely touched', async () => {
      const built = await buildService({
        configValues: { PROPOSITION_ANALYSIS_MAX_TOKENS: '1000' },
        llmText: 'prose that never opens a JSON object',
        llmFinishReason: 'stop',
        llmTokensOut: 12,
      });

      await built.service.generate('prop-1');

      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('reason=no_json');
    });

    it('logs sizes but never the response body', async () => {
      const built = await buildService({
        llmText: 'ELEPHANT'.repeat(50),
      });

      await built.service.generate('prop-1');

      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('responseChars=400');
      expect(line).toContain('inputChars=');
      // A 400-character ramble in the log costs the reader the signal they
      // came for, and the position in a JSON.parse message drags the body in
      // by the back door.
      expect(line).not.toContain('ELEPHANT');
    });

    it('clears a recorded failure once the measure analyses', async () => {
      const built = await buildService();

      await built.service.generate('prop-1');

      const data = built.db.proposition.update.mock.calls[0][0].data;
      expect(data.analysisFailureReason).toBeNull();
      expect(data.analysisFailedAt).toBeNull();
      expect(data.analysisSummary).toBeDefined();
    });

    it('names the failed measures instead of emitting a bare ratio', async () => {
      const built = await buildService({
        findMany: [
          baseProp({ id: 'p1', externalId: '25-0036A1' }),
          baseProp({ id: 'p2', externalId: '26-0003' }),
        ],
        llmText: 'no json here',
      });

      await built.service.generateMissing();

      // `Generated 4/8` was the only production signal this ever emitted, and
      // it names no measure and gives no reason.
      const summary = warn.mock.calls
        .map((call) => call[0] as string)
        .find((line) => line.includes('proposition analyses'));
      expect(summary).toContain('0/2');
      expect(summary).toContain('25-0036A1 (no_json)');
      expect(summary).toContain('26-0003 (no_json)');
    });
  });

  describe('PropositionAnalysisService — claim dual-write (#1293)', () => {
    beforeEach(() => {
      recordClaimsMock.mockClear();
      recordClaimsMock.mockResolvedValue({ written: 0, byState: {} });
    });

    /** Reuses the suite's harness by name so the fixtures stay in one place. */
    async function generate(): Promise<{
      db: { proposition: { update: jest.Mock } };
    }> {
      const built = await buildService();
      await built.service.generate('prop-1');
      return built;
    }

    it('mirrors the surviving claims into the evidence graph', async () => {
      await generate();

      // The call itself, not just its availability — dual-writes that
      // typechecked and wrote nothing shipped three times in this milestone.
      expect(recordClaimsMock).toHaveBeenCalledTimes(1);
      const input = recordClaimsMock.mock.calls[0][1];
      expect(input.subjectType).toBe('proposition');
      expect(input.subjectId).toBe('prop-1');
      expect(input.claims.map((c) => c.text)).toContain('X applies');
      // The inverted-offset claim the normalizer dropped must not reappear here.
      expect(input.claims.map((c) => c.text)).not.toContain(
        'should be dropped',
      );
    });

    it('verifies against the same text version the row records (#1279)', async () => {
      await generate();

      const input = recordClaimsMock.mock.calls[0][1];
      expect(input.sourceText).toBe(FULL_TEXT);
      expect(input.sourceTextHash).toBe(FULL_TEXT_HASH);
    });

    it('keeps the analysis when the dual-write fails', async () => {
      recordClaimsMock.mockRejectedValue(new Error('evidence table is gone'));
      const built = await generate();

      // The analysis is what citizens read. Losing it to a failure of a mirror
      // nothing reads yet would be the wrong trade — #1294 backfills instead.
      expect(built.db.proposition.update).toHaveBeenCalledTimes(1);
      const data = built.db.proposition.update.mock.calls[0][0].data;
      expect(data.analysisSummary).toBeDefined();
      expect(data.analysisFailureReason).toBeNull();
    });
  });
});
