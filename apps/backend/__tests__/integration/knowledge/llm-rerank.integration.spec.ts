/**
 * End-to-end integration for the LLM re-rank pipeline (#745 Subtask 3)
 * against a real Postgres. Stubs the LLM + prompt-client (third-party
 * IO) — the value of this suite is exercising the real DB writes from
 * `LlmRerankService` and the real cache overlay in
 * `PersonalizedFeedService.getFeedForUser`. Per CLAUDE.md the DB layer
 * is never mocked.
 *
 *   1. Rerank writes a cache row with the LLM-returned explanation.
 *   2. The resolver-facing `getFeedForUser` overlays that explanation
 *      onto the embedding-only result.
 *   3. When the LLM returns `{ skip: true }`, the cache row still exists
 *      with `relevanceExplanation: null` so the feed serves with the
 *      embedding-only rank (the no-explanation fallback required by the
 *      AC).
 *   4. Expired cache rows are NOT overlaid — the resolver returns the
 *      result undecorated so the next nightly run can refresh it.
 */
import { Logger } from '@nestjs/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/llm-provider';
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createBill,
  getDbService,
} from '../utils';
import { ConfigService } from '@nestjs/config';
import { ScoringService } from '../../../src/apps/knowledge/src/domains/personalized-feed/scoring.service';
import { PersonalizedFeedService } from '../../../src/apps/knowledge/src/domains/personalized-feed/personalized-feed.service';
import { LlmRerankService } from '../../../src/apps/knowledge/src/domains/personalized-feed/llm-rerank.service';
import { ExplanationValidatorService } from '../../../src/apps/knowledge/src/domains/personalized-feed/explanation-validator.service';
import { CostBudgetService } from '../../../src/apps/knowledge/src/domains/personalized-feed/cost-budget.service';
import type { PersonalizationInputDto } from '../../../src/apps/knowledge/src/domains/personalized-feed/dto/personalization-input.dto';

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

interface LlmStub extends ILLMProvider {
  readonly calls: string[];
}

function makeLlmStub(responder: (prompt: string) => string): LlmStub {
  const calls: string[] = [];
  const llm: LlmStub = {
    calls,
    getName: () => 'stub',
    getModelName: () => 'stub-1',
    async isAvailable() {
      return true;
    },
    async generate(prompt: string) {
      calls.push(prompt);
      return {
        text: responder(prompt),
        tokensUsed: 10,
        finishReason: 'stop',
      };
    },
    async *generateStream() {},
    async chat() {
      return { text: '', tokensUsed: 0, finishReason: 'stop' };
    },
  };
  return llm;
}

function makePromptClientStub(): PromptClientService {
  return {
    getBillRelevanceExplanationPrompt: jest.fn().mockResolvedValue({
      promptText: 'rendered prompt for test',
      promptHash: 'h'.repeat(64),
      promptVersion: 'v1',
    }),
  } as unknown as PromptClientService;
}

describe('LlmRerankService + PersonalizedFeedService cache overlay (real DB)', () => {
  let feed: PersonalizedFeedService;
  let rerank: LlmRerankService;
  let llm: LlmStub;
  let promptClient: PromptClientService;

  const input: PersonalizationInputDto = {
    interestTags: ['housing'],
    flags: { ...FLAGS_OFF, isRenter: true, isParent: true },
  };

  beforeEach(async () => {
    await cleanDatabase();
    const db = await getDbService();
    feed = new PersonalizedFeedService(db, new ScoringService());
    promptClient = makePromptClientStub();
    llm = makeLlmStub(() =>
      JSON.stringify({
        explanation:
          'Caps rent for renter parents in 94110 — directly affects housing costs you mentioned and could lower your monthly bills meaningfully.',
        citedSection: '12345',
        citedSignals: ['isRenter', 'housing'],
      }),
    );
    rerank = new LlmRerankService(
      db,
      feed,
      promptClient,
      new ExplanationValidatorService(),
      new CostBudgetService(db, {
        get: () => undefined,
      } as unknown as ConfigService),
      llm,
    );
    // Silence the structured-log lines the service emits — the test
    // already asserts on the summary return value + DB state.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('writes a cache row, and the feed overlay returns the cached explanation', async () => {
    const user = await createUser({ email: 'rerank-e2e@example.com' });
    await createBill({
      billNumber: 'AB 1',
      title: 'ADU fee cap',
      lastActionDate: new Date(),
      aiSummary: {
        plainEnglishSummary: 'Caps ADU fees.',
        topics: ['housing'],
        whoItAffects: ['renters'],
        fiscalImpact: { level: 'low', summary: 'Negligible.' },
        stakeholderImpact: 'Renters benefit.',
      },
      aiSummaryVersion: 'v1',
    });

    const summary = await rerank.rerankForUser(user.id, input);
    expect(summary.candidatesConsidered).toBe(1);
    expect(summary.cacheWritesWithExplanation).toBe(1);

    const result = await feed.getFeedForUser(user.id, input, 5);
    expect(result).toHaveLength(1);
    expect(result[0].relevanceExplanation).toContain(
      'Caps rent for renter parents',
    );
  });

  it('persists the row but leaves explanation null when LLM returns { skip: true }', async () => {
    llm = makeLlmStub(() =>
      JSON.stringify({ skip: true, reason: 'no overlap' }),
    );
    const db = await getDbService();
    rerank = new LlmRerankService(
      db,
      feed,
      promptClient,
      new ExplanationValidatorService(),
      new CostBudgetService(db, {
        get: () => undefined,
      } as unknown as ConfigService),
      llm,
    );

    const user = await createUser({ email: 'rerank-skip@example.com' });
    await createBill({
      billNumber: 'AB 2',
      title: 'Veteran benefits',
      lastActionDate: new Date(),
      aiSummary: {
        plainEnglishSummary: 'Funds veteran tuition.',
        topics: ['education'],
        whoItAffects: ['veterans'],
      },
      aiSummaryVersion: 'v1',
    });

    const summary = await rerank.rerankForUser(user.id, {
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });
    expect(summary.cacheWritesWithoutExplanation).toBe(1);

    const rows = await db.billRelevanceCache.findMany({
      where: { userId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].relevanceExplanation).toBeNull();
  });

  it('ignores expired cache rows on the overlay path', async () => {
    const db = await getDbService();
    const user = await createUser({ email: 'rerank-expired@example.com' });
    const bill = await createBill({
      billNumber: 'AB 3',
      title: 'Bus fare cap',
      lastActionDate: new Date(),
      aiSummary: {
        plainEnglishSummary: 'Caps bus fares.',
        topics: ['transportation'],
        whoItAffects: ['renters'],
      },
      aiSummaryVersion: 'v1',
    });

    // Pre-seed an EXPIRED cache row.
    await db.billRelevanceCache.create({
      data: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0.9,
        relevanceExplanation: 'stale explanation',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const result = await feed.getFeedForUser(user.id, input, 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].relevanceExplanation).toBeUndefined();
  });

  it('upsert overwrites the existing row on re-run rather than duplicating', async () => {
    const db = await getDbService();
    const user = await createUser({ email: 'rerank-upsert@example.com' });
    await createBill({
      billNumber: 'AB 4',
      title: 'X',
      lastActionDate: new Date(),
      aiSummary: {
        plainEnglishSummary: 'Y.',
        topics: ['housing'],
        whoItAffects: ['renters'],
      },
      aiSummaryVersion: 'v1',
    });

    await rerank.rerankForUser(user.id, input);
    await rerank.rerankForUser(user.id, input);

    const rows = await db.billRelevanceCache.findMany({
      where: { userId: user.id },
    });
    expect(rows).toHaveLength(1);
  });
});
