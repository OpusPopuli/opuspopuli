/**
 * Integration for the non-petition classification gate (#1057, subtask 2)
 * against a real Postgres. Stubs the LLM + prompt-client (third-party IO);
 * the value here is the real persistence semantics: the verdict lives in
 * the same analysis Json as any analysis, rides the same (contentHash,
 * type) cache — the same menu scanned by anyone resolves without a second
 * LLM call — and forceReanalyze replaces a wrong verdict in place.
 */
import type { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/llm-provider';
import type { MetricsService } from '../../../src/common/metrics';
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createDocument,
  getDbService,
} from '../utils';
import { AnalysisService } from '../../../src/apps/documents/src/domains/services/analysis.service';
import { LinkingService } from '../../../src/apps/documents/src/domains/services/linking.service';

const CONTENT_HASH = 'feedface'.padEnd(64, '0');

const MENU_TEXT =
  'Chef specials — soup of the day, grilled salmon with seasonal greens, ' +
  'house-made tiramisu. Ask your server about our wine pairings tonight.';

interface LlmStub extends ILLMProvider {
  readonly calls: string[];
  respondWith: (text: string) => void;
}

function makeLlmStub(): LlmStub {
  const calls: string[] = [];
  let response = '{"skip": true, "reason": "not_a_petition"}';
  const llm: LlmStub = {
    calls,
    respondWith: (text: string) => {
      response = text;
    },
    getName: () => 'stub',
    getModelName: () => 'stub-1',
    async isAvailable() {
      return true;
    },
    async generate(prompt: string) {
      calls.push(prompt);
      return { text: response, tokensUsed: 25, finishReason: 'stop' };
    },
    async *generateStream() {},
    async chat() {
      return { text: '', tokensUsed: 0, finishReason: 'stop' };
    },
  };
  return llm;
}

const promptClientStub = {
  getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
    promptText: 'rendered petition prompt',
    promptHash: 'h'.repeat(64),
    promptVersion: 'v2',
  }),
} as unknown as PromptClientService;

const metricsStub = {
  recordAnalysisCacheHit: () => undefined,
  recordAnalysisCacheMiss: () => undefined,
  recordAnalysis: () => undefined,
} as unknown as MetricsService;

describe('Non-petition verdict persistence (real DB)', () => {
  let service: AnalysisService;
  let llm: LlmStub;

  beforeEach(async () => {
    await cleanDatabase();
    const db = await getDbService();
    llm = makeLlmStub();
    service = new AnalysisService(
      db,
      llm,
      promptClientStub,
      metricsStub,
      new LinkingService(db),
    );
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function makeScannedDocument(email: string) {
    const user = await createUser({ email });
    const doc = await createDocument({
      userId: user.id,
      type: 'petition',
      contentHash: CONTENT_HASH,
      extractedText: MENU_TEXT,
      status: 'text_extraction_complete',
    });
    return { user, doc };
  }

  it('persists the verdict and serves it from the shared content cache', async () => {
    const a = await makeScannedDocument('verdict-a@example.com');

    const first = await service.analyzeDocument(a.user.id, a.doc.id);
    expect(first.fromCache).toBe(false);
    expect(first.analysis).toMatchObject({
      isPetition: false,
      skipReason: 'not_a_petition',
      summary: '',
    });

    const db = await getDbService();
    const persisted = await db.document.findUnique({
      where: { id: a.doc.id },
    });
    expect(persisted?.status).toBe('ai_analysis_complete');
    expect(persisted?.analysis).toMatchObject({ isPetition: false });
    // Nothing from the document text may leak into the verdict.
    expect(JSON.stringify(persisted?.analysis)).not.toContain('salmon');

    // A different user scanning the SAME content gets the cached verdict —
    // one LLM call total.
    const b = await makeScannedDocument('verdict-b@example.com');
    const second = await service.analyzeDocument(b.user.id, b.doc.id);
    expect(second.fromCache).toBe(true);
    expect(second.analysis).toMatchObject({ isPetition: false });
    expect(llm.calls).toHaveLength(1);
  });

  it('forceReanalyze replaces a wrong verdict with a real analysis in place', async () => {
    const { user, doc } = await makeScannedDocument('verdict-fix@example.com');

    await service.analyzeDocument(user.id, doc.id);

    // The classifier was wrong; a re-run now yields a genuine analysis.
    llm.respondWith(
      '{"summary":"Caps annual rent increases at 5%.","keyPoints":["Rent cap"],"entities":["County Board"]}',
    );
    const recovered = await service.analyzeDocument(user.id, doc.id, true);

    expect(recovered.fromCache).toBe(false);
    expect(recovered.analysis).toMatchObject({
      isPetition: true,
      summary: 'Caps annual rent increases at 5%.',
    });

    const db = await getDbService();
    const persisted = await db.document.findUnique({ where: { id: doc.id } });
    expect(persisted?.analysis).toMatchObject({ isPetition: true });
  });

  it('pre-gates near-empty text without an LLM call', async () => {
    const user = await createUser({ email: 'verdict-pregate@example.com' });
    const doc = await createDocument({
      userId: user.id,
      type: 'petition',
      contentHash: 'ab'.padEnd(64, '1'),
      extractedText: 'menu $5',
      status: 'text_extraction_complete',
    });

    const result = await service.analyzeDocument(user.id, doc.id);

    expect(result.analysis).toMatchObject({
      isPetition: false,
      skipReason: 'unreadable',
      model: 'min-text-gate',
    });
    expect(llm.calls).toHaveLength(0);
  });
});
