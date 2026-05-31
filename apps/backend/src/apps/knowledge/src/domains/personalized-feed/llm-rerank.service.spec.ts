import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { LlmRerankService } from './llm-rerank.service';
import { PersonalizedFeedService } from './personalized-feed.service';
import { ExplanationValidatorService } from './explanation-validator.service';
import { CostBudgetService } from './cost-budget.service';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';

/**
 * Unit tests for the LLM re-rank orchestrator (#745). Validates the
 * cache-write paths under the four execution outcomes:
 *   - LLM returns a valid explanation → row with explanation + hash
 *   - LLM returns `{ skip: true }` → row with null explanation
 *   - LLM returns garbage JSON → row with null explanation
 *   - LLM throws → row with null explanation + llmFailures++
 *
 * The "always write a cache row" behavior is the no-explanation
 * fallback required by the AC — the feed must serve even when every
 * LLM call in a batch fails.
 */

const FLAGS_OFF: PersonalizationInputDto['flags'] = {
  isRenter: false,
  isHomeowner: false,
  isParent: false,
  isCaregiver: false,
  isStudent: false,
  isEducator: false,
  isWorker: false,
  isBusinessOwner: false,
  isUnionMember: false,
  isGigWorker: false,
  isTransitRider: false,
  isDriver: false,
  hasSpecialLicense: false,
  hasImmigrationConcern: false,
  hasHealthCondition: false,
  hasPublicHealthInsurance: false,
  isVeteran: false,
  hasJusticeInvolvement: false,
  isLowIncome: false,
  receivesPublicBenefits: false,
};

const BASE_INPUT: PersonalizationInputDto = {
  interestTags: ['housing'],
  flags: { ...FLAGS_OFF, isRenter: true, isParent: true },
};

const FEED_RESULT = [
  {
    billId: 'b-1',
    relevanceScore: 0.82,
    axisScores: {
      directMaterial: 0.6,
      valuesAlignment: 1.0,
      actionability: 0.5,
      indirectMaterial: 0,
      coalitionSignal: 0,
      counterfactual: 0,
      noveltyRepetition: 0,
    },
  },
];

const BILL_ROW = {
  id: 'b-1',
  regionId: 'california',
  billNumber: 'AB 1',
  sessionYear: '2025-2026',
  title: 'ADU fee cap',
  aiSummary: {
    plainEnglishSummary: 'Caps ADU fees.',
    topics: ['housing'],
    whoItAffects: ['homeowners', 'renters'],
    fiscalImpact: { level: 'low', summary: 'Negligible.' },
    stakeholderImpact: 'Homeowners benefit.',
  },
};

function makeMocks() {
  const db = {
    // After the #745 review batch-lookup refactor, rerankForUser calls
    // bill.findMany({ where: { id: { in: billIds } } }) once per rerank
    // instead of bill.findUnique per candidate.
    bill: { findMany: jest.fn().mockResolvedValue([]) },
    personalizedFeedCache: { upsert: jest.fn() },
  } as unknown as jest.Mocked<DbService>;
  const feed = {
    getFeedForUser: jest.fn().mockResolvedValue(FEED_RESULT),
  } as unknown as jest.Mocked<PersonalizedFeedService>;
  const promptClient = {
    getBillRelevanceExplanationPrompt: jest.fn(),
  } as unknown as jest.Mocked<PromptClientService>;
  const llm = {
    generate: jest.fn(),
    getName: jest.fn().mockReturnValue('mock'),
    getModelName: jest.fn().mockReturnValue('mock'),
    generateStream: jest.fn(),
    chat: jest.fn(),
  };
  // Default validator: accept everything. Individual tests override.
  const validator = {
    validate: jest.fn().mockReturnValue({ valid: true }),
  } as unknown as jest.Mocked<ExplanationValidatorService>;
  // Default budget: always within. Individual tests override.
  const budget = {
    withinBudget: jest.fn().mockResolvedValue(true),
    dailyCap: 10_000,
  } as unknown as jest.Mocked<CostBudgetService>;
  return { db, feed, promptClient, llm, validator, budget };
}

async function makeService(deps: ReturnType<typeof makeMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LlmRerankService,
      { provide: DbService, useValue: deps.db },
      { provide: PersonalizedFeedService, useValue: deps.feed },
      { provide: PromptClientService, useValue: deps.promptClient },
      { provide: ExplanationValidatorService, useValue: deps.validator },
      { provide: CostBudgetService, useValue: deps.budget },
      { provide: 'LLM_PROVIDER', useValue: deps.llm },
    ],
  }).compile();
  return module.get(LlmRerankService);
}

describe('LlmRerankService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes an explained cache row when the LLM returns valid JSON', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    });
    deps.llm.generate.mockResolvedValue({
      text: JSON.stringify({
        explanation: 'Caps rent costs in 94110.',
        citedSection: '12345',
        citedSignals: ['isRenter', 'housing'],
      }),
      tokensUsed: 42,
      finishReason: 'stop',
    });

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(summary.candidatesConsidered).toBe(1);
    expect(summary.cacheWritesWithExplanation).toBe(1);
    expect(summary.cacheWritesWithoutExplanation).toBe(0);
    expect(summary.llmFailures).toBe(0);
    expect(summary.totalTokens).toBe(42);

    expect(deps.db.personalizedFeedCache.upsert).toHaveBeenCalledTimes(1);
    const call = (deps.db.personalizedFeedCache.upsert as jest.Mock).mock
      .calls[0][0];
    expect(call.where).toEqual({
      userId_billId: { userId: 'u-1', billId: 'b-1' },
    });
    expect(call.create.relevanceExplanation).toBe('Caps rent costs in 94110.');
    expect(call.create.templateHash).toBe('h'.repeat(64));
    expect(call.create.tokensOut).toBe(42);
    expect(call.update.relevanceExplanation).toBe('Caps rent costs in 94110.');
  });

  it('writes a null-explanation cache row when the LLM returns { skip: true }', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    });
    deps.llm.generate.mockResolvedValue({
      text: JSON.stringify({ skip: true, reason: 'No overlap.' }),
      tokensUsed: 10,
      finishReason: 'stop',
    });

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(summary.cacheWritesWithExplanation).toBe(0);
    expect(summary.cacheWritesWithoutExplanation).toBe(1);
    expect(summary.llmFailures).toBe(0);

    const call = (deps.db.personalizedFeedCache.upsert as jest.Mock).mock
      .calls[0][0];
    expect(call.create.relevanceExplanation).toBeNull();
    // Skip is still a successful LLM call — hash + tokens still recorded
    expect(call.create.templateHash).toBe('h'.repeat(64));
    expect(call.create.tokensOut).toBe(10);
  });

  it('writes a null-explanation cache row when the LLM returns malformed JSON', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    });
    deps.llm.generate.mockResolvedValue({
      text: 'I am a friendly LLM and refuse to follow your format',
      tokensUsed: 5,
      finishReason: 'stop',
    });

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(summary.cacheWritesWithExplanation).toBe(0);
    expect(summary.cacheWritesWithoutExplanation).toBe(1);

    const call = (deps.db.personalizedFeedCache.upsert as jest.Mock).mock
      .calls[0][0];
    expect(call.create.relevanceExplanation).toBeNull();
  });

  it('writes a null-explanation cache row + increments llmFailures when the LLM call throws', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    });
    deps.llm.generate.mockRejectedValue(new Error('Ollama unreachable'));

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(summary.cacheWritesWithExplanation).toBe(0);
    expect(summary.cacheWritesWithoutExplanation).toBe(1);
    expect(summary.llmFailures).toBe(1);

    const call = (deps.db.personalizedFeedCache.upsert as jest.Mock).mock
      .calls[0][0];
    expect(call.create.relevanceExplanation).toBeNull();
    expect(call.create.templateHash).toBeNull();
  });

  it('passes the TRUE-only RankingFlags list into the prompt-client params', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    });
    deps.llm.generate.mockResolvedValue({
      text: JSON.stringify({ explanation: 'x'.repeat(50) }),
      tokensUsed: 1,
      finishReason: 'stop',
    });

    const service = await makeService(deps);
    await service.rerankForUser('u-1', BASE_INPUT);

    const params =
      deps.promptClient.getBillRelevanceExplanationPrompt.mock.calls[0][0];
    expect(params.userRankingFlags).toEqual(
      expect.arrayContaining(['isRenter', 'isParent']),
    );
    expect(params.userRankingFlags).not.toContain('isHomeowner');
    expect(params.userInterestTags).toEqual(['housing']);
  });

  it('drops the explanation + increments validatorRejections when validator rejects', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    });
    deps.llm.generate.mockResolvedValue({
      text: JSON.stringify({
        explanation: 'You should vote yes on this bill.',
      }),
      tokensUsed: 12,
      finishReason: 'stop',
    });
    (deps.validator.validate as jest.Mock).mockReturnValue({
      valid: false,
      rejectionReason: 'opinion-language',
    });

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(summary.cacheWritesWithExplanation).toBe(0);
    expect(summary.cacheWritesWithoutExplanation).toBe(1);
    expect(summary.validatorRejections).toBe(1);
    expect(summary.llmFailures).toBe(0);

    const call = (deps.db.personalizedFeedCache.upsert as jest.Mock).mock
      .calls[0][0];
    expect(call.create.relevanceExplanation).toBeNull();
    // The hash + tokens are still recorded — the LLM call succeeded;
    // it's the explanation that got dropped.
    expect(call.create.templateHash).toBe('h'.repeat(64));
    expect(call.create.tokensOut).toBe(12);
  });

  it('skips LLM call + writes embedding-only row when budget is exhausted', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
    (deps.budget.withinBudget as jest.Mock).mockResolvedValue(false);

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(summary.budgetExhausted).toBe(true);
    expect(deps.llm.generate).not.toHaveBeenCalled();
    expect(
      deps.promptClient.getBillRelevanceExplanationPrompt,
    ).not.toHaveBeenCalled();
    expect(summary.cacheWritesWithoutExplanation).toBe(1);

    const call = (deps.db.personalizedFeedCache.upsert as jest.Mock).mock
      .calls[0][0];
    expect(call.create.relevanceExplanation).toBeNull();
    expect(call.create.templateHash).toBeNull();
  });

  it('skips bills with no aiSummary on the bill row', async () => {
    const deps = makeMocks();
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([
      { ...BILL_ROW, aiSummary: null },
    ]);

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(deps.llm.generate).not.toHaveBeenCalled();
    expect(deps.db.personalizedFeedCache.upsert).toHaveBeenCalledTimes(1);
    expect(summary.cacheWritesWithoutExplanation).toBe(1);
  });

  it('B3 regression: skips the cache upsert when the candidate bill row is missing (hard-deleted between rank and rerank)', async () => {
    const deps = makeMocks();
    // findMany returns empty — bill was deleted between feed.getFeedForUser
    // and the rerank loop. The cache upsert would otherwise throw P2003.
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([]);

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(deps.llm.generate).not.toHaveBeenCalled();
    expect(deps.db.personalizedFeedCache.upsert).not.toHaveBeenCalled();
    expect(summary.cacheWritesWithExplanation).toBe(0);
    expect(summary.cacheWritesWithoutExplanation).toBe(0);
    expect(summary.candidatesConsidered).toBe(1);
  });
});
