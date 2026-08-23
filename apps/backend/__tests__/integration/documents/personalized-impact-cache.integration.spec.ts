/**
 * Integration for the personalized-impact cache (#1052 Subtask 3) against a
 * real Postgres. Stubs the LLM + prompt-client (third-party IO) — the value
 * of this suite is exercising the real cache reads/writes in
 * `PersonalizedImpactService` against `personalized_impact_cache`. Per
 * CLAUDE.md the DB layer is never mocked.
 *
 * The cache key `(userId, contentHash, documentType, promptVersion,
 * profileHash)` is a privacy control, not just perf: rows are scoped to
 * their owner (a shared cross-user cache is a membership-inference oracle —
 * 2026-08-22 review), distinct declared-signal profiles get distinct reads,
 * and a prompt-template update invalidates every stale read.
 */
import type { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/llm-provider';
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createDocument,
  getDbService,
} from '../utils';
import { PersonalizedImpactService } from '../../../src/apps/documents/src/domains/services/personalized-impact.service';
import type { PersonalizedImpactInput } from '../../../src/apps/documents/src/domains/dto/personalized-impact.dto';
import type { MetricsService } from '../../../src/common/metrics';

const CONTENT_HASH = 'c0ffee'.padEnd(64, '0');

const ANALYSIS = {
  summary: 'Caps annual rent increases at 5%.',
  actualEffect: 'Limits annual rent hikes.',
  beneficiaries: ['renters'],
  potentiallyHarmed: ['landlords'],
};

interface LlmStub extends ILLMProvider {
  readonly calls: string[];
}

function makeLlmStub(): LlmStub {
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
      // Distinct per call, so a cache hit (identical text) is
      // distinguishable from an accidental regeneration.
      return {
        text: `personalized read #${calls.length}`,
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

function makePromptClientStub(promptVersion = 'v1'): PromptClientService {
  return {
    getPersonalizedImpactPrompt: jest.fn().mockResolvedValue({
      promptText: 'rendered personalized-impact prompt',
      promptHash: 'h'.repeat(64),
      promptVersion,
    }),
  } as unknown as PromptClientService;
}

const metricsStub = {
  recordAnalysisCacheHit: () => undefined,
  recordAnalysisCacheMiss: () => undefined,
} as unknown as MetricsService;

describe('PersonalizedImpactService cache (real DB)', () => {
  let service: PersonalizedImpactService;
  let llm: LlmStub;

  const renterInput = (documentId: string): PersonalizedImpactInput => ({
    documentId,
    interestTags: ['housing'],
    rankingFlags: ['isRenter'],
    regionLabel: '94xxx',
  });

  async function makeService(promptVersion = 'v1') {
    const db = await getDbService();
    llm = makeLlmStub();
    return new PersonalizedImpactService(
      db,
      llm,
      makePromptClientStub(promptVersion),
      metricsStub,
    );
  }

  beforeEach(async () => {
    await cleanDatabase();
    service = await makeService();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function makeAnalyzedDocument(
    email: string,
    contentHash = CONTENT_HASH,
  ) {
    const user = await createUser({ email });
    const doc = await createDocument({
      userId: user.id,
      type: 'petition',
      contentHash,
      analysis: ANALYSIS,
    });
    return { user, doc };
  }

  it('generates once, then serves the same profile from the cache', async () => {
    const { user, doc } = await makeAnalyzedDocument('impact-hit@example.com');

    const first = await service.generate(user.id, renterInput(doc.id));
    expect(first).toMatchObject({
      text: 'personalized read #1',
      fromCache: false,
    });

    const second = await service.generate(user.id, renterInput(doc.id));
    expect(second).toMatchObject({
      text: 'personalized read #1',
      fromCache: true,
    });
    expect(llm.calls).toHaveLength(1);

    const db = await getDbService();
    const rows = await db.personalizedImpactCache.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      contentHash: CONTENT_HASH,
      documentType: 'petition',
      promptVersion: 'v1',
      impactText: 'personalized read #1',
      llmProvider: 'stub',
      llmModel: 'stub-1',
      tokensUsed: 10,
    });
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives distinct profiles distinct reads — never another profile’s row', async () => {
    const { user, doc } = await makeAnalyzedDocument(
      'impact-profiles@example.com',
    );

    const renter = await service.generate(user.id, renterInput(doc.id));
    const veteran = await service.generate(user.id, {
      ...renterInput(doc.id),
      rankingFlags: ['isVeteran'],
    });

    expect(renter?.fromCache).toBe(false);
    expect(veteran?.fromCache).toBe(false);
    expect(veteran?.text).not.toEqual(renter?.text);
    expect(llm.calls).toHaveLength(2);

    const db = await getDbService();
    const rows = await db.personalizedImpactCache.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.profileHash)).size).toBe(2);

    // Each profile re-hits its OWN row.
    const renterAgain = await service.generate(user.id, renterInput(doc.id));
    expect(renterAgain).toMatchObject({ text: renter?.text, fromCache: true });
    expect(llm.calls).toHaveLength(2);
  });

  it('never shares rows across users — even for identical content and profile', async () => {
    const a = await makeAnalyzedDocument('impact-scope-a@example.com');
    const b = await makeAnalyzedDocument('impact-scope-b@example.com');

    const first = await service.generate(a.user.id, renterInput(a.doc.id));
    const second = await service.generate(b.user.id, renterInput(b.doc.id));

    // A shared row here would be a membership-inference oracle: user B's
    // first call coming back fromCache would prove that someone with
    // exactly this declared profile scanned this petition. Each user pays
    // their own generation instead.
    expect(first?.fromCache).toBe(false);
    expect(second?.fromCache).toBe(false);
    expect(llm.calls).toHaveLength(2);

    const db = await getDbService();
    expect(await db.personalizedImpactCache.count()).toBe(2);
  });

  it('misses the cache when the prompt template version changes', async () => {
    const { user, doc } = await makeAnalyzedDocument(
      'impact-version@example.com',
    );

    await service.generate(user.id, renterInput(doc.id));

    // Same user, same profile, same content — new template version.
    const v2Service = await makeService('v2');
    const regenerated = await v2Service.generate(user.id, renterInput(doc.id));

    expect(regenerated).toMatchObject({
      text: 'personalized read #1', // the v2 service's own stub counter
      fromCache: false,
      promptVersion: 'v2',
    });

    const db = await getDbService();
    const versions = (await db.personalizedImpactCache.findMany()).map(
      (r) => r.promptVersion,
    );
    expect(versions.sort()).toEqual(['v1', 'v2']);
  });

  it('returns null and writes nothing when there are no declared signals', async () => {
    const { user, doc } = await makeAnalyzedDocument('impact-none@example.com');

    const result = await service.generate(user.id, {
      documentId: doc.id,
      interestTags: [],
      rankingFlags: [],
    });

    expect(result).toBeNull();
    expect(llm.calls).toHaveLength(0);
    const db = await getDbService();
    expect(await db.personalizedImpactCache.count()).toBe(0);
  });

  it('regenerates when the cached row has expired, and sweeps long-expired rows', async () => {
    const { user, doc } = await makeAnalyzedDocument(
      'impact-expired@example.com',
    );

    await service.generate(user.id, renterInput(doc.id));
    const db = await getDbService();
    await db.personalizedImpactCache.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const regenerated = await service.generate(user.id, renterInput(doc.id));
    expect(regenerated).toMatchObject({
      text: 'personalized read #2',
      fromCache: false,
    });
    expect(llm.calls).toHaveLength(2);
    // The expired row was overwritten in place, not duplicated.
    expect(await db.personalizedImpactCache.count()).toBe(1);

    // A row expired for longer than the sweep grace is deleted by the next
    // write (any user's) — writes are this table's only growth moment, so
    // they double as the storage sweep.
    await db.personalizedImpactCache.updateMany({
      data: { expiresAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });
    const other = await makeAnalyzedDocument('impact-sweeper@example.com');
    await service.generate(other.user.id, renterInput(other.doc.id));
    const remaining = await db.personalizedImpactCache.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(other.user.id);
  });
});
