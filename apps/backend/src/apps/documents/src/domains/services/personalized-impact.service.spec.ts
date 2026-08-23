import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';

import { MetricsService } from 'src/common/metrics';
import { PersonalizedImpactService } from './personalized-impact.service';
import { PersonalizedImpactInput } from '../dto/personalized-impact.dto';

describe('PersonalizedImpactService', () => {
  let service: PersonalizedImpactService;
  let db: {
    document: { findFirst: jest.Mock };
    personalizedImpactCache: {
      findFirst: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let llm: {
    generate: jest.Mock;
    getName: jest.Mock;
    getModelName: jest.Mock;
  };
  let promptClient: jest.Mocked<PromptClientService>;
  let metrics: {
    recordAnalysisCacheHit: jest.Mock;
    recordAnalysisCacheMiss: jest.Mock;
  };

  const baseInput: PersonalizedImpactInput = {
    documentId: 'doc-1',
    interestTags: ['housing'],
    rankingFlags: ['isRenter'],
    regionLabel: '94xxx',
  };

  const docWithAnalysis = {
    id: 'doc-1',
    type: 'petition',
    contentHash: 'c'.repeat(64),
    analysis: {
      summary: 'Caps rent increases at 5%.',
      actualEffect: 'Limits annual rent hikes.',
      beneficiaries: ['renters'],
      potentiallyHarmed: ['landlords'],
    },
  };

  const promptResponse = {
    promptText: 'PROMPT',
    promptHash: 'a'.repeat(64),
    promptVersion: 'v2',
  };

  beforeEach(async () => {
    db = {
      document: { findFirst: jest.fn() },
      personalizedImpactCache: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    llm = {
      generate: jest.fn(),
      getName: jest.fn().mockReturnValue('TestLLM'),
      getModelName: jest.fn().mockReturnValue('test-model'),
    };
    promptClient = createMock<PromptClientService>();
    metrics = {
      recordAnalysisCacheHit: jest.fn(),
      recordAnalysisCacheMiss: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedImpactService,
        { provide: DbService, useValue: db },
        { provide: 'LLM_PROVIDER', useValue: llm },
        { provide: PromptClientService, useValue: promptClient },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = module.get(PersonalizedImpactService);
  });

  it('returns null when the user has no declared signals (nothing to personalize)', async () => {
    const result = await service.generate('user-1', {
      ...baseInput,
      interestTags: [],
      rankingFlags: [],
    });
    expect(result).toBeNull();
    expect(db.document.findFirst).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('treats whitespace-only signals as no declared signals', async () => {
    const result = await service.generate('user-1', {
      ...baseInput,
      interestTags: ['  '],
      rankingFlags: [''],
    });
    expect(result).toBeNull();
    expect(db.document.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when the document is missing or unanalyzed', async () => {
    db.document.findFirst.mockResolvedValueOnce(null);
    expect(await service.generate('user-1', baseInput)).toBeNull();

    db.document.findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      analysis: null,
    });
    expect(await service.generate('user-1', baseInput)).toBeNull();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('generates a personalized read from the analysis + declared signals', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    llm.generate.mockResolvedValue({
      text: '  As a renter, this caps your rent.  ',
    });

    const result = await service.generate('user-1', baseInput);

    expect(result).toEqual({
      text: 'As a renter, this caps your rent.',
      provider: 'TestLLM',
      model: 'test-model',
      promptVersion: 'v2',
      fromCache: false,
    });
    // Only declared signals + analysis fields reach the prompt.
    expect(promptClient.getPersonalizedImpactPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'petition',
        summary: 'Caps rent increases at 5%.',
        beneficiaries: ['renters'],
        potentiallyHarmed: ['landlords'],
        userInterestTags: ['housing'],
        userRankingFlags: ['isRenter'],
        userRegionLabel: '94xxx',
      }),
    );
  });

  it('returns null when the LLM yields empty text', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    llm.generate.mockResolvedValue({ text: '   ' });

    expect(await service.generate('user-1', baseInput)).toBeNull();
    expect(db.personalizedImpactCache.upsert).not.toHaveBeenCalled();
  });

  it('persists keyed by (userId, contentHash, documentType, promptVersion, profileHash)', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    llm.generate.mockResolvedValue({
      text: 'As a renter, this caps your rent.',
      tokensUsed: 42,
    });

    await service.generate('user-1', baseInput);

    expect(db.personalizedImpactCache.upsert).toHaveBeenCalledTimes(1);
    const call = db.personalizedImpactCache.upsert.mock.calls[0][0];
    expect(
      call.where.userId_contentHash_documentType_promptVersion_profileHash,
    ).toEqual({
      userId: 'user-1',
      contentHash: docWithAnalysis.contentHash,
      documentType: 'petition',
      promptVersion: 'v2',
      profileHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(call.create).toMatchObject({
      userId: 'user-1',
      impactText: 'As a renter, this caps your rent.',
      promptHash: promptResponse.promptHash,
      llmProvider: 'TestLLM',
      llmModel: 'test-model',
      tokensUsed: 42,
    });
    expect(call.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Writes piggyback the storage sweep for long-expired rows.
    expect(db.personalizedImpactCache.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('serves a fresh cache row without calling the LLM', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    db.personalizedImpactCache.findFirst.mockResolvedValueOnce({
      impactText: 'Cached read.',
      llmProvider: 'TestLLM',
      llmModel: 'test-model',
    });

    const result = await service.generate('user-1', baseInput);

    expect(result).toEqual({
      text: 'Cached read.',
      provider: 'TestLLM',
      model: 'test-model',
      promptVersion: 'v2',
      fromCache: true,
    });
    expect(llm.generate).not.toHaveBeenCalled();
    expect(metrics.recordAnalysisCacheHit).toHaveBeenCalled();
    // The lookup is scoped to the requesting user and stays fresh-only.
    const where = db.personalizedImpactCache.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe('user-1');
    expect(where.documentType).toBe('petition');
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it('records a cache miss metric when generating', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    llm.generate.mockResolvedValue({ text: 'read' });

    await service.generate('user-1', baseInput);
    expect(metrics.recordAnalysisCacheMiss).toHaveBeenCalled();
    expect(metrics.recordAnalysisCacheHit).not.toHaveBeenCalled();
  });

  it('keys the cache by a canonicalized declared-signal profile hash', async () => {
    const profileHashFor = async (input: PersonalizedImpactInput) => {
      db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
      promptClient.getPersonalizedImpactPrompt.mockResolvedValue(
        promptResponse,
      );
      llm.generate.mockResolvedValue({ text: 'read' });
      await service.generate('user-1', input);
      const calls = db.personalizedImpactCache.findFirst.mock.calls;
      return calls[calls.length - 1][0].where.profileHash;
    };

    const renter = await profileHashFor(baseInput);
    const veteran = await profileHashFor({
      ...baseInput,
      rankingFlags: ['isVeteran'],
    });
    // Distinct profiles must never share a cache row.
    expect(renter).not.toEqual(veteran);

    // Order, duplicates, and whitespace do not change the profile identity.
    const twoTags = await profileHashFor({
      ...baseInput,
      interestTags: ['housing', 'transit'],
    });
    const equivalent = await profileHashFor({
      ...baseInput,
      interestTags: ['transit', ' housing ', 'transit'],
    });
    expect(twoTags).toEqual(equivalent);

    // Empty and missing regionLabel are the same profile.
    const noLabel = await profileHashFor({
      ...baseInput,
      regionLabel: undefined,
    });
    const blankLabel = await profileHashFor({
      ...baseInput,
      regionLabel: '  ',
    });
    expect(noLabel).toEqual(blankLabel);
  });

  it('skips the cache entirely when the document has no contentHash', async () => {
    db.document.findFirst.mockResolvedValueOnce({
      ...docWithAnalysis,
      contentHash: null,
    });
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    llm.generate.mockResolvedValue({ text: 'Fresh read.' });

    const result = await service.generate('user-1', baseInput);

    expect(result?.text).toBe('Fresh read.');
    expect(result?.fromCache).toBe(false);
    expect(db.personalizedImpactCache.findFirst).not.toHaveBeenCalled();
    expect(db.personalizedImpactCache.upsert).not.toHaveBeenCalled();
  });

  it('still returns the generated read when the cache write fails', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue(promptResponse);
    llm.generate.mockResolvedValue({ text: 'Generated read.' });
    db.personalizedImpactCache.upsert.mockRejectedValueOnce(
      new Error('db down'),
    );

    const result = await service.generate('user-1', baseInput);
    expect(result?.text).toBe('Generated read.');
    expect(result?.fromCache).toBe(false);
  });
});
