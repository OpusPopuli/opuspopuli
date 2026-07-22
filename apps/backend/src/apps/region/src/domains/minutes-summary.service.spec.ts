import { ConfigService } from '@nestjs/config';
import type { ILLMProvider } from '@opuspopuli/common';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MinutesSummaryService } from './minutes-summary.service';

const MINUTES_ROW = {
  id: 'm-1',
  externalId: 'california-meetings-2026-07-13',
  body: 'Assembly',
  date: new Date('2026-07-13'),
  rawText: 'ROLLCALL ... Committee voted 5-2 to advance AB 1234 ...',
  summary: null as string | null,
};

const VALID_LLM_JSON = JSON.stringify({
  summary: 'The Assembly advanced AB 1234 out of committee.',
  claims: [
    {
      kind: 'decision',
      title: 'Voted 5-2 to advance AB 1234',
      detail: 'Appropriations advanced the bill to the floor.',
      citation: { pageHint: 'p. 3', quote: 'voted 5-2 to advance AB 1234' },
      billRefs: ['AB-1234'],
      severity: 'medium',
    },
    // invalid kind → dropped
    { kind: 'bogus', title: 'x', detail: 'y', citation: {} },
    // missing title → dropped
    { kind: 'concern', title: '   ', detail: 'y', citation: {} },
  ],
});

interface Mocks {
  service: MinutesSummaryService;
  db: {
    minutes: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  llm: { generate: jest.Mock };
}

function build(opts: { llmText?: string; findUnique?: unknown } = {}): Mocks {
  const { llmText = VALID_LLM_JSON, findUnique = { ...MINUTES_ROW } } = opts;

  const promptClient = {
    getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
      promptText: 'built prompt',
      promptHash: 'h',
      promptVersion: 'v1',
    }),
  } as unknown as PromptClientService;

  const llm = {
    generate: jest.fn(async () => ({ text: llmText })),
  } as unknown as ILLMProvider & { generate: jest.Mock };

  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const db = {
    minutes: {
      findUnique: jest.fn().mockResolvedValue(findUnique),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as DbService & Mocks['db'];

  const service = new MinutesSummaryService(config, promptClient, llm, db);
  return {
    service,
    db: db as unknown as Mocks['db'],
    llm: llm as Mocks['llm'],
  };
}

describe('MinutesSummaryService', () => {
  it('returns false when dependencies are missing', async () => {
    const service = new MinutesSummaryService();
    await expect(service.summarize('m-1')).resolves.toBe(false);
  });

  it('writes summary + only the well-formed claims', async () => {
    const { service, db } = build();

    const ok = await service.summarize('m-1');

    expect(ok).toBe(true);
    expect(db.minutes.update).toHaveBeenCalledTimes(1);
    const data = db.minutes.update.mock.calls[0][0].data;
    expect(data.summary).toBe(
      'The Assembly advanced AB 1234 out of committee.',
    );
    // 3 claims in, 2 invalid dropped → only the decision survives
    expect(data.summaryClaims).toHaveLength(1);
    expect(data.summaryClaims[0]).toMatchObject({
      kind: 'decision',
      title: 'Voted 5-2 to advance AB 1234',
      billRefs: ['AB-1234'],
      severity: 'medium',
    });
  });

  it('skips a row with no rawText', async () => {
    const { service, db } = build({
      findUnique: { ...MINUTES_ROW, rawText: null },
    });
    await expect(service.summarize('m-1')).resolves.toBe(false);
    expect(db.minutes.update).not.toHaveBeenCalled();
  });

  it('skips an already-summarized row unless force', async () => {
    const { service, db } = build({
      findUnique: { ...MINUTES_ROW, summary: 'existing synopsis' },
    });

    await expect(service.summarize('m-1')).resolves.toBe(false);
    expect(db.minutes.update).not.toHaveBeenCalled();

    await expect(service.summarize('m-1', true)).resolves.toBe(true);
    expect(db.minutes.update).toHaveBeenCalledTimes(1);
  });

  it('refuses to persist when the LLM output has no parseable summary', async () => {
    const { service, db } = build({ llmText: 'not json at all' });
    await expect(service.summarize('m-1')).resolves.toBe(false);
    expect(db.minutes.update).not.toHaveBeenCalled();
  });
});
