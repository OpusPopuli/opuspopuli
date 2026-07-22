/**
 * MinutesSummaryService integration (#813).
 *
 * Unit specs mock DbService, so they cover parse/normalize/write logic but
 * not the real Prisma JSONB round-trip of `summary_claims`. This exercises
 * the full backend path against the real test database: insert a minutes row
 * with rawText → summarize (deterministic LLM stub) → assert summary +
 * summaryClaims persisted → read back through RegionQueryService's mapper and
 * assert the GraphQL model shape.
 *
 * The LLM is stubbed (deterministic) — asserting real prompt/claim quality
 * against an actual journal PDF is a manual eval, not a CI test.
 */
import type { ConfigService } from '@nestjs/config';
import type { ILLMProvider } from '@opuspopuli/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MinutesSummaryService } from '../../../src/apps/region/src/domains/minutes-summary.service';
import { RegionQueryService } from '../../../src/apps/region/src/domains/region-query.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const LLM_JSON = JSON.stringify({
  summary:
    'Appropriations advanced AB 1234 to the floor and heard public testimony on SB 56.',
  claims: [
    {
      kind: 'decision',
      title: 'Voted 5-2 to advance AB 1234',
      detail: 'Appropriations reported AB 1234 do-pass to the floor.',
      citation: { pageHint: 'p. 3', quote: 'AB 1234 ... do pass' },
      billRefs: ['AB-1234'],
    },
    {
      kind: 'public_comment',
      title: 'Testimony on SB 56',
      detail: 'Witnesses spoke in support of SB 56.',
      citation: { quote: 'in support of SB 56' },
      billRefs: ['SB-56'],
    },
    // malformed — dropped by the normalizer
    { kind: 'nope', title: 'x', detail: 'y', citation: {} },
  ],
});

describe('MinutesSummaryService (integration)', () => {
  let db: DbService;
  let service: MinutesSummaryService;

  const promptClient = {
    getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
      promptText: 'prompt',
      promptHash: 'h',
      promptVersion: 'v1',
    }),
  } as unknown as PromptClientService;
  const llm = {
    generate: jest.fn().mockResolvedValue({ text: LLM_JSON, tokensUsed: 321 }),
  } as unknown as ILLMProvider;
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    service = new MinutesSummaryService(config, promptClient, llm, db);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function insertMinutes(): Promise<string> {
    const row = await db.minutes.create({
      data: {
        externalId: 'california-meetings-2026-07-13',
        body: 'Assembly',
        date: new Date('2026-07-13'),
        sourceUrl: 'https://clerk.example/adj071326.pdf',
        rawText: 'ROLLCALL ... AB 1234 do pass ... in support of SB 56 ...',
      },
      select: { id: true },
    });
    return row.id;
  }

  it('persists summary + summaryClaims JSONB and reads back through the mapper', async () => {
    const minutesId = await insertMinutes();

    const wrote = await service.summarize(minutesId);
    expect(wrote).toBe(true);

    // Real JSONB round-trip on the row.
    const row = await db.minutes.findUnique({
      where: { id: minutesId },
      select: { summary: true, summaryClaims: true },
    });
    expect(row?.summary).toContain('AB 1234');
    const claims = row?.summaryClaims as Array<{ kind: string }>;
    expect(claims).toHaveLength(2); // malformed third claim dropped
    expect(claims[0].kind).toBe('decision');

    // Read back through the GraphQL mapper.
    const query = new RegionQueryService(db, {
      cachedQuery: (_k: string, fn: () => unknown) => fn(),
    } as never);
    const model = await query.getMinutesById(minutesId);
    expect(model).not.toBeNull();
    expect(model!.summary).toContain('AB 1234');
    expect(model!.claims).toHaveLength(2);
    expect(model!.claims[0]).toMatchObject({
      kind: 'decision',
      billRefs: ['AB-1234'],
    });
    expect(model!.claims[0].citation.quote).toContain('do pass');
  });

  it('leaves an already-summarized row untouched unless force', async () => {
    const minutesId = await insertMinutes();
    await service.summarize(minutesId);
    llm.generate = jest.fn().mockResolvedValue({
      text: JSON.stringify({ summary: 'v2', claims: [] }),
    });
    (service as unknown as { llm: ILLMProvider }).llm = llm;

    // No force → skipped.
    await expect(service.summarize(minutesId)).resolves.toBe(false);
    // Force → regenerated.
    await expect(service.summarize(minutesId, true)).resolves.toBe(true);
    const row = await db.minutes.findUnique({
      where: { id: minutesId },
      select: { summary: true },
    });
    expect(row?.summary).toBe('v2');
  });
});
