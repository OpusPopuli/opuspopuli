import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { LlmRerankService } from './llm-rerank.service';
import { PersonalizedFeedService } from './personalized-feed.service';
import { ExplanationValidatorService } from './explanation-validator.service';
import { CostBudgetService } from './cost-budget.service';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';
import { expiryFor } from './llm-rerank.service';

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
    billRelevanceCache: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
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

    expect(deps.db.billRelevanceCache.upsert).toHaveBeenCalledTimes(1);
    const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
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

    const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
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

    const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
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

    const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
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

    const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
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

    const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
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
    expect(deps.db.billRelevanceCache.upsert).toHaveBeenCalledTimes(1);
    expect(summary.cacheWritesWithoutExplanation).toBe(1);
  });

  // ============================================================
  // Multi-entity rerank (opuspopuli#836) — proposition / representative
  // / committee variants. Same control flow as bills (budget → prompt →
  // LLM → validate → upsert), exercised per entity type with the
  // entity-specific cache table. The committee tests also lock in the
  // membersOnUserSlate privacy contract.
  // ============================================================

  describe('rerankPropositionsForUser (#836)', () => {
    function makeMultiEntityMocks() {
      const m = makeMocks();
      // Augment with the entity-specific tables + prompt-client methods
      // the multi-entity flow touches.
      (
        m.db as unknown as { proposition: { findMany: jest.Mock } }
      ).proposition = { findMany: jest.fn().mockResolvedValue([]) };
      (
        m.db as unknown as {
          propositionRelevanceCache: { upsert: jest.Mock; findMany: jest.Mock };
        }
      ).propositionRelevanceCache = {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      };
      (
        m.promptClient as unknown as {
          getPropositionRelevanceExplanationPrompt: jest.Mock;
        }
      ).getPropositionRelevanceExplanationPrompt = jest.fn();
      return m;
    }

    const PROP_ROW = {
      id: 'p-1',
      externalId: 'Measure J',
      title: 'Rent Control Expansion Act',
      electionDate: new Date('2026-11-03T00:00:00Z'),
      analysisSummary: 'Expands rent control to post-1995 buildings.',
      fiscalImpact: '$50M annual cost.',
      yesOutcome: 'Renters gain protections.',
      noOutcome: 'Status quo.',
    };

    it('writes an explained cache row on a positive LLM response', async () => {
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { proposition: { findMany: jest.Mock } }
      ).proposition.findMany.mockResolvedValue([PROP_ROW]);
      (
        deps.promptClient as unknown as {
          getPropositionRelevanceExplanationPrompt: jest.Mock;
        }
      ).getPropositionRelevanceExplanationPrompt.mockResolvedValue({
        promptText: 'PROMPT',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({
          explanation: 'Would expand rent control — relevant to renters.',
          citedProvision: 'expanding rent-control authority',
          citedSignals: ['isRenter', 'housing'],
        }),
        tokensUsed: 33,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      const summary = await service.rerankPropositionsForUser(
        'u-1',
        BASE_INPUT,
        ['p-1'],
      );

      expect(summary.cacheWritesWithExplanation).toBe(1);
      expect(summary.cacheWritesWithoutExplanation).toBe(0);
      const upsertCall = (
        deps.db as unknown as {
          propositionRelevanceCache: { upsert: jest.Mock; findMany: jest.Mock };
        }
      ).propositionRelevanceCache.upsert.mock.calls[0][0];
      expect(upsertCall.where).toEqual({
        userId_propositionId: { userId: 'u-1', propositionId: 'p-1' },
      });
      expect(upsertCall.create.relevanceExplanation).toBe(
        'Would expand rent control — relevant to renters.',
      );
    });

    it('skips candidates with no analysisSummary (incomplete ingest)', async () => {
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { proposition: { findMany: jest.Mock } }
      ).proposition.findMany.mockResolvedValue([
        { ...PROP_ROW, analysisSummary: null },
      ]);
      const service = await makeService(deps);
      const summary = await service.rerankPropositionsForUser(
        'u-1',
        BASE_INPUT,
        ['p-1'],
      );
      expect(summary.cacheWritesWithExplanation).toBe(0);
      expect(summary.cacheWritesWithoutExplanation).toBe(0);
      expect(
        (
          deps.db as unknown as {
            propositionRelevanceCache: {
              upsert: jest.Mock;
              findMany: jest.Mock;
            };
          }
        ).propositionRelevanceCache.upsert,
      ).not.toHaveBeenCalled();
    });
  });

  describe('rerankRepresentativesForUser (#836)', () => {
    function makeMultiEntityMocks() {
      const m = makeMocks();
      (
        m.db as unknown as { representative: { findMany: jest.Mock } }
      ).representative = { findMany: jest.fn().mockResolvedValue([]) };
      (
        m.db as unknown as {
          representativeRelevanceCache: {
            upsert: jest.Mock;
            findMany: jest.Mock;
          };
        }
      ).representativeRelevanceCache = {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      };
      (
        m.promptClient as unknown as {
          getRepresentativeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getRepresentativeRelevanceExplanationPrompt = jest.fn();
      return m;
    }

    const REP_ROW = {
      id: 'r-1',
      regionId: 'california',
      name: 'Rep. Zoe Lofgren',
      chamber: 'U.S. House',
      district: 'CA-18',
      party: 'democrat',
      bio: 'Represents CA-18.',
      committeesSummary: null,
      committees: [{ name: 'House Judiciary Committee' }],
      activitySummary: 'Voted for HR 4821.',
    };

    it('writes an explained cache row + builds params from the rep row', async () => {
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { representative: { findMany: jest.Mock } }
      ).representative.findMany.mockResolvedValue([REP_ROW]);
      const promptMock = (
        deps.promptClient as unknown as {
          getRepresentativeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getRepresentativeRelevanceExplanationPrompt;
      promptMock.mockResolvedValue({
        promptText: 'PROMPT',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({
          explanation: 'Sits on Judiciary — relevant to your housing focus.',
          citedAnchor: 'House Judiciary Committee',
          citedSignals: ['isRenter', 'housing'],
        }),
        tokensUsed: 28,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      const summary = await service.rerankRepresentativesForUser(
        'u-1',
        BASE_INPUT,
        ['r-1'],
      );

      expect(summary.cacheWritesWithExplanation).toBe(1);
      const promptArgs = promptMock.mock.calls[0][0];
      expect(promptArgs.repName).toBe('Rep. Zoe Lofgren');
      expect(promptArgs.officeTitle).toBe('U.S. House CA-18');
      expect(promptArgs.jurisdiction).toBe('federal');
      expect(promptArgs.party).toBe('democrat');
      expect(promptArgs.committeeMemberships).toEqual([
        'House Judiciary Committee',
      ]);
      expect(promptArgs.recentLegislativeAction).toBe('Voted for HR 4821.');
    });

    it('coerces unknown party labels to undefined (defensive)', async () => {
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { representative: { findMany: jest.Mock } }
      ).representative.findMany.mockResolvedValue([
        { ...REP_ROW, party: 'monarchist' },
      ]);
      const promptMock = (
        deps.promptClient as unknown as {
          getRepresentativeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getRepresentativeRelevanceExplanationPrompt;
      promptMock.mockResolvedValue({
        promptText: 'PROMPT',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({ skip: true, reason: 'no match' }),
        tokensUsed: 5,
        finishReason: 'stop',
      });
      const service = await makeService(deps);
      await service.rerankRepresentativesForUser('u-1', BASE_INPUT, ['r-1']);
      expect(promptMock.mock.calls[0][0].party).toBeUndefined();
    });
  });

  describe('rerankCommitteesForUser (#836) — privacy contract', () => {
    function makeMultiEntityMocks() {
      const m = makeMocks();
      (
        m.db as unknown as { legislativeCommittee: { findMany: jest.Mock } }
      ).legislativeCommittee = { findMany: jest.fn().mockResolvedValue([]) };
      (
        m.db as unknown as {
          committeeRelevanceCache: { upsert: jest.Mock; findMany: jest.Mock };
        }
      ).committeeRelevanceCache = {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      };
      (
        m.promptClient as unknown as {
          getCommitteeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getCommitteeRelevanceExplanationPrompt = jest.fn();
      return m;
    }

    const COMMITTEE_ROW = {
      id: 'c-1',
      name: 'Assembly Judiciary Committee',
      chamber: 'Assembly',
      description: 'Reviews civil + criminal procedure legislation.',
      activitySummary: null,
    };

    it('PRIVACY CONTRACT: passes membersOnUserSlate verbatim — does NOT mutate, does NOT extend, does NOT fabricate', async () => {
      // This test is the keystone enforcement of the prompt-service#81
      // contract: the caller-supplied membersOnUserSlate is the intersect
      // of committee members ∩ user's resolved rep slate. The service
      // MUST pass it through unchanged. If the service ever lookups
      // committee members and merges them in, the LLM will fabricate
      // "your rep serves on it" claims for reps the user doesn't even have.
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { legislativeCommittee: { findMany: jest.Mock } }
      ).legislativeCommittee.findMany.mockResolvedValue([COMMITTEE_ROW]);
      const promptMock = (
        deps.promptClient as unknown as {
          getCommitteeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getCommitteeRelevanceExplanationPrompt;
      promptMock.mockResolvedValue({
        promptText: 'PROMPT',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({
          explanation: 'Your rep Lofgren sits on it.',
          citedAnchor: 'Lofgren',
          citedSignals: ['isRenter', 'housing'],
        }),
        tokensUsed: 24,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      await service.rerankCommitteesForUser('u-1', BASE_INPUT, [
        {
          legislativeCommitteeId: 'c-1',
          membersOnUserSlate: ['Lofgren'],
        },
      ]);

      const params = promptMock.mock.calls[0][0];
      // Critical contract assertion: the array on the prompt call args
      // matches the caller-supplied input EXACTLY.
      expect(params.membersOnUserSlate).toEqual(['Lofgren']);
      // No phantom names from the committee_members JSON or anywhere else.
      expect(params.membersOnUserSlate).not.toContain('Padilla');
      expect(params.membersOnUserSlate).not.toContain('Wiener');
    });

    it('PRIVACY CONTRACT: empty membersOnUserSlate stays empty (caller passes [], service does not enrich)', async () => {
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { legislativeCommittee: { findMany: jest.Mock } }
      ).legislativeCommittee.findMany.mockResolvedValue([COMMITTEE_ROW]);
      const promptMock = (
        deps.promptClient as unknown as {
          getCommitteeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getCommitteeRelevanceExplanationPrompt;
      promptMock.mockResolvedValue({
        promptText: 'PROMPT',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({ skip: true, reason: 'no overlap' }),
        tokensUsed: 6,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      await service.rerankCommitteesForUser('u-1', BASE_INPUT, [
        { legislativeCommitteeId: 'c-1', membersOnUserSlate: [] },
      ]);

      expect(promptMock.mock.calls[0][0].membersOnUserSlate).toEqual([]);
    });

    it('writes the cache row keyed by (userId, legislativeCommitteeId)', async () => {
      const deps = makeMultiEntityMocks();
      (
        deps.db as unknown as { legislativeCommittee: { findMany: jest.Mock } }
      ).legislativeCommittee.findMany.mockResolvedValue([COMMITTEE_ROW]);
      (
        deps.promptClient as unknown as {
          getCommitteeRelevanceExplanationPrompt: jest.Mock;
        }
      ).getCommitteeRelevanceExplanationPrompt.mockResolvedValue({
        promptText: 'PROMPT',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({
          explanation: 'Your rep sits on it.',
          citedSignals: ['isRenter', 'housing'],
        }),
        tokensUsed: 20,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      await service.rerankCommitteesForUser('u-1', BASE_INPUT, [
        { legislativeCommitteeId: 'c-1', membersOnUserSlate: ['Lofgren'] },
      ]);

      const upsertCall = (
        deps.db as unknown as {
          committeeRelevanceCache: { upsert: jest.Mock; findMany: jest.Mock };
        }
      ).committeeRelevanceCache.upsert.mock.calls[0][0];
      expect(upsertCall.where).toEqual({
        userId_legislativeCommitteeId: {
          userId: 'u-1',
          legislativeCommitteeId: 'c-1',
        },
      });
    });
  });

  it('B3 regression: skips the cache upsert when the candidate bill row is missing (hard-deleted between rank and rerank)', async () => {
    const deps = makeMocks();
    // findMany returns empty — bill was deleted between feed.getFeedForUser
    // and the rerank loop. The cache upsert would otherwise throw P2003.
    (deps.db.bill.findMany as jest.Mock).mockResolvedValue([]);

    const service = await makeService(deps);
    const summary = await service.rerankForUser('u-1', BASE_INPUT);

    expect(deps.llm.generate).not.toHaveBeenCalled();
    expect(deps.db.billRelevanceCache.upsert).not.toHaveBeenCalled();
    expect(summary.cacheWritesWithExplanation).toBe(0);
    expect(summary.cacheWritesWithoutExplanation).toBe(0);
    expect(summary.candidatesConsidered).toBe(1);
  });
  describe('empty results are not cached as success', () => {
    /*
     * The incident this pins. prompt-service was dropped from a deploy, every
     * generation returned empty, and each empty result was written with the
     * full 7-day TTL — 484 empty rows against one with content. Nothing
     * errored; the cache read as fresh and valid, and the briefing rendered
     * zero items. The outage lasted minutes; the blackout was scheduled to
     * last a week.
     *
     * A row with no explanation must expire soon enough to recover on its own
     * once the cause is fixed.
     */
    const HOUR = 60 * 60 * 1000;

    it('gives an empty explanation a short TTL, not the 7-day one', () => {
      const normalExpiry = new Date(Date.now() + 7 * 24 * HOUR);

      const empty = expiryFor(null, normalExpiry);
      const filled = expiryFor('because you care about housing', normalExpiry);

      // Recovers within the hour rather than next week.
      expect(empty.getTime()).toBeLessThan(Date.now() + HOUR);
      // A real explanation keeps the full TTL — this must not make the cache
      // useless by expiring everything quickly.
      expect(filled).toBe(normalExpiry);
    });

    it('treats an empty string like a failure, not content', () => {
      const normalExpiry = new Date(Date.now() + 7 * 24 * HOUR);

      // validateAccepted can return '' rather than null; both mean "nothing to
      // show", and the production rows were empty strings.
      expect(expiryFor('', normalExpiry).getTime()).toBeLessThan(
        Date.now() + HOUR,
      );
    });
  });
  describe('freshness skip and token accounting', () => {
    /*
     * Nothing checked the cache before generating, so the nightly cron
     * regenerated every explanation for every user every night while writing
     * a 7-day TTL. The cache was read on the request path and ignored on the
     * write path — roughly a 7x overspend, and the single largest lever on
     * how many users one node can serve.
     */
    const withBill = () => {
      const deps = makeMocks();
      (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
      deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
        promptText: 'p',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({ explanation: 'Caps rent costs in 94110.' }),
        tokensUsed: 42,
        finishReason: 'stop',
      });
      return deps;
    };

    it('skips a candidate that already has a fresh explanation', async () => {
      const deps = withBill();
      (deps.db.billRelevanceCache.findMany as jest.Mock).mockResolvedValue([
        { billId: 'b-1', relevanceExplanation: 'still good' },
      ]);

      const service = await makeService(deps);
      const summary = await service.rerankForUser('u-1', BASE_INPUT);

      expect(deps.llm.generate).not.toHaveBeenCalled();
      expect(deps.db.billRelevanceCache.upsert).not.toHaveBeenCalled();
      // `candidatesConsidered` stays the candidate count — how many existed,
      // not how many cost anything. `skippedFresh` is what says the cache did
      // its job, and a run reporting 1 considered / 1 skipped did no
      // inference at all.
      expect(summary.candidatesConsidered).toBe(1);
      expect(summary.skippedFresh).toBe(1);
    });

    it('regenerates when the cached explanation is EMPTY, even if unexpired', async () => {
      // A row cached from a failed generation gets a short retry TTL by
      // design. Treating it as fresh would make a prompt-service outage
      // self-perpetuating: nothing generated, nothing retried.
      const deps = withBill();
      (deps.db.billRelevanceCache.findMany as jest.Mock).mockResolvedValue([
        { billId: 'b-1', relevanceExplanation: '' },
      ]);

      const service = await makeService(deps);
      await service.rerankForUser('u-1', BASE_INPUT);

      expect(deps.llm.generate).toHaveBeenCalled();
    });

    it('only considers unexpired rows fresh', async () => {
      const deps = withBill();
      const service = await makeService(deps);
      await service.rerankForUser('u-1', BASE_INPUT);

      const where = (deps.db.billRelevanceCache.findMany as jest.Mock).mock
        .calls[0][0].where;
      // Stale entries must regenerate — that is what the TTL is for.
      expect(where.expiresAt).toHaveProperty('gt');
      expect(where.userId).toBe('u-1');
    });

    it('records input AND output tokens separately', async () => {
      const deps = withBill();
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({ explanation: 'Caps rent costs in 94110.' }),
        tokensUsed: 940,
        tokensIn: 880,
        tokensOut: 60,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      await service.rerankForUser('u-1', BASE_INPUT);

      const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
        .calls[0][0];
      // Input was previously discarded, leaving every stored tokens_in NULL
      // and making spend impossible to account for.
      expect(call.create.tokensIn).toBe(880);
      expect(call.create.tokensOut).toBe(60);
    });

    it('falls back to the total when a provider reports no split', async () => {
      const deps = withBill();

      const service = await makeService(deps);
      await service.rerankForUser('u-1', BASE_INPUT);

      const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
        .calls[0][0];
      expect(call.create.tokensOut).toBe(42);
      expect(call.create.tokensIn).toBeNull();
    });
  });
  describe('empty results must not clobber existing explanations', () => {
    /*
     * The production incident this pins: a manual rerank ran with the daily
     * token budget already exhausted. Every candidate yielded an empty
     * result, and the unconditional upsert UPDATE overwrote the user's 205
     * good committee and representative explanations with empty rows —
     * emptying their briefing on launch day. A run that produced nothing
     * must leave prior work alone.
     */
    it('budget-exhausted run leaves the existing explanation untouched', async () => {
      const deps = makeMocks();
      (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
      // Budget says no — every candidate becomes an empty result.
      (deps.budget.withinBudget as jest.Mock).mockResolvedValue(false);

      const service = await makeService(deps);
      await service.rerankForUser('u-1', BASE_INPUT);

      const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
        .calls[0][0];
      // CREATE still writes the empty retry row for users with no cache…
      expect(call.create.relevanceExplanation).toBeNull();
      // …but UPDATE must not carry the wrecking ball. The embedding score may
      // refresh; the explanation, telemetry and expiry must be absent.
      expect(call.update).not.toHaveProperty('relevanceExplanation');
      expect(call.update).not.toHaveProperty('expiresAt');
    });

    it('a successful result still updates in full', async () => {
      const deps = makeMocks();
      (deps.db.bill.findMany as jest.Mock).mockResolvedValue([BILL_ROW]);
      deps.promptClient.getBillRelevanceExplanationPrompt.mockResolvedValue({
        promptText: 'p',
        promptHash: 'h'.repeat(64),
        promptVersion: 'v1',
      });
      deps.llm.generate.mockResolvedValue({
        text: JSON.stringify({ explanation: 'Caps rent costs in 94110.' }),
        tokensUsed: 42,
        finishReason: 'stop',
      });

      const service = await makeService(deps);
      await service.rerankForUser('u-1', BASE_INPUT);

      const call = (deps.db.billRelevanceCache.upsert as jest.Mock).mock
        .calls[0][0];
      expect(call.update.relevanceExplanation).toBe(
        'Caps rent costs in 94110.',
      );
      expect(call.update).toHaveProperty('expiresAt');
    });
  });
});
