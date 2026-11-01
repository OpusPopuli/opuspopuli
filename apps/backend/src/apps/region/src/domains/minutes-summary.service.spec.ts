import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ILLMProvider } from '@opuspopuli/common';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { recordClaims } from './claim-recorder';
import {
  MINUTES_SUMMARY_TEMPLATE,
  MinutesSummaryService,
} from './minutes-summary.service';

jest.mock('./claim-recorder', () => ({
  recordClaims: jest.fn().mockResolvedValue({ written: 0, byState: {} }),
}));

const recordClaimsMock = recordClaims as jest.MockedFunction<
  typeof recordClaims
>;

const MINUTES_ROW = {
  id: 'm-1',
  externalId: 'california-meetings-2026-07-13',
  body: 'Assembly',
  date: new Date('2026-07-13'),
  rawText: 'ROLLCALL ... Committee voted 5-2 to advance AB 1234 ...',
  sourceVersionId: null as string | null,
  summary: null as string | null,
  summaryPromptHash: null as string | null,
  summaryLlmDigest: null as string | null,
  summarySourceHash: null as string | null,
  summaryConfigHash: null as string | null,
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
  getPromptHash: jest.Mock;
}

function build(
  opts: {
    llmText?: string;
    findUnique?: unknown;
    findMany?: unknown[];
    /** The hash of this generator's own template; a rejection means it is missing. */
    templateHash?: string | Error;
    /** The hash of document-analysis-generic, the fallback. */
    genericHash?: string;
  } = {},
): Mocks {
  const {
    llmText = VALID_LLM_JSON,
    findUnique = { ...MINUTES_ROW },
    findMany = [],
    templateHash = 'h',
    genericHash = 'g',
  } = opts;

  const hashes: Record<string, string> = {
    'document-analysis-generic': genericHash,
  };
  const getPromptHash = jest.fn((name: string) => {
    if (templateHash instanceof Error) return Promise.reject(templateHash);
    if (name === MINUTES_SUMMARY_TEMPLATE) return Promise.resolve(templateHash);
    return Promise.resolve(hashes[name] ?? 'x');
  });
  const promptClient = {
    // What was SERVED: 'h' unless a test says the fallback served it.
    getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
      promptText: 'built prompt',
      promptHash: 'h',
      promptVersion: 'v1',
    }),
    getPromptHash,
  } as unknown as PromptClientService;

  const llm = {
    getModelName: jest.fn().mockReturnValue('qwen-test:9b'),
    // #1281: the weights behind the tag, resolved by the provider.
    getModelDigest: jest.fn().mockResolvedValue('stub-digest'),
    generate: jest.fn(async () => ({ text: llmText })),
  } as unknown as ILLMProvider & { generate: jest.Mock };

  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const db = {
    minutes: {
      findUnique: jest.fn().mockResolvedValue(findUnique),
      findMany: jest.fn().mockResolvedValue(findMany),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as DbService & Mocks['db'];

  const service = new MinutesSummaryService(config, promptClient, llm, db);
  return {
    service,
    db: db as unknown as Mocks['db'],
    llm: llm as Mocks['llm'],
    getPromptHash,
  };
}

/** A row as one successful run leaves it: summary, attribution and key. */
async function summarizedRow(): Promise<typeof MINUTES_ROW> {
  const { service, db } = build();
  await service.summarize('m-1');
  const data = db.minutes.update.mock.calls[0][0].data;
  return {
    ...MINUTES_ROW,
    summary: data.summary,
    summaryPromptHash: data.summaryPromptHash,
    summaryLlmDigest: data.summaryLlmDigest,
    summarySourceHash: data.summarySourceHash,
    summaryConfigHash: data.summaryConfigHash,
  };
}

describe('MinutesSummaryService', () => {
  it('skips when dependencies are missing', async () => {
    const service = new MinutesSummaryService();
    await expect(service.summarize('m-1')).resolves.toBe('skipped');
  });

  it('writes summary + only the well-formed claims', async () => {
    const { service, db } = build();

    const outcome = await service.summarize('m-1');

    expect(outcome).toBe('created');
    expect(db.minutes.update).toHaveBeenCalledTimes(1);
    const data = db.minutes.update.mock.calls[0][0].data;
    // The skip key's input and config axes ride the same write.
    expect(data.summarySourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.summaryConfigHash).toEqual(expect.any(String));
    expect(data.summary).toBe(
      'The Assembly advanced AB 1234 out of committee.',
    );
    // #1149 — the attribution triple rides the same write.
    expect(data.summaryPromptHash).toBe('h');
    expect(data.summaryPromptVersion).toBe('v1');
    expect(data.summaryLlmModel).toBe('qwen-test:9b');
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
    await expect(service.summarize('m-1')).resolves.toBe('skipped');
    expect(db.minutes.update).not.toHaveBeenCalled();
  });

  it('skips a current summary unless force', async () => {
    const current = await summarizedRow();
    const { service, db, llm } = build({ findUnique: current });

    await expect(service.summarize('m-1')).resolves.toBe('unchanged');
    expect(llm.generate).not.toHaveBeenCalled();
    expect(db.minutes.update).not.toHaveBeenCalled();

    await expect(service.summarize('m-1', true)).resolves.toBe('updated');
    expect(db.minutes.update).toHaveBeenCalledTimes(1);
  });

  it('regenerates a summary that names no prompt — the pre-attribution rows', async () => {
    // 48 of 58 summaries locally: present, but with no summary_prompt_hash.
    // "Has a summary" skipped them forever; the key says stale.
    const { service, llm } = build({
      findUnique: { ...MINUTES_ROW, summary: 'old synopsis' },
    });
    await expect(service.summarize('m-1')).resolves.toBe('updated');
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the prompt', { summaryPromptHash: 'older' }],
    ['the model', { summaryLlmDigest: 'older' }],
    ['the input', { summarySourceHash: 'f'.repeat(64) }],
    ['the settings', { summaryConfigHash: 'older' }],
  ])('regenerates when %s changed', async (_axis, change) => {
    const { service, llm } = build({
      findUnique: { ...(await summarizedRow()), ...change },
    });
    await expect(service.summarize('m-1')).resolves.toBe('updated');
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('stamps a legacy summary current instead of regenerating it', async () => {
    // Live prompt and weights, recorded before the input and config axes.
    const legacy = {
      ...(await summarizedRow()),
      summarySourceHash: null,
      summaryConfigHash: null,
    };
    const { service, db, llm } = build({ findUnique: legacy });

    await expect(service.summarize('m-1')).resolves.toBe('unchanged');
    expect(llm.generate).not.toHaveBeenCalled();
    expect(db.minutes.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: {
        summarySourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        summaryConfigHash: expect.any(String),
      },
    });
  });

  it('says so when the output hit the token ceiling', async () => {
    // Cut off mid-object: it fails as "no JSON object", which on its own
    // reads as a model fault rather than a budget one.
    const { service, llm } = build();
    llm.generate.mockResolvedValueOnce({
      text: '{"summary": "The Assem',
      finishReason: 'length',
      tokensOut: 4000,
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.summarize('m-1')).resolves.toBe('failed');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('hit the 4000-token ceiling'),
    );
    warn.mockRestore();
  });

  it('repairs a quote mark copied unescaped from the document', async () => {
    // Every claim quotes the minutes verbatim, and the minutes quote people:
    // the defect class civics measured, through the same shared repair.
    const unescaped =
      '{"summary": "The Assembly met.", "claims": [{"kind": "public_comment", ' +
      '"title": "Witness opposed AB-1", "detail": "", ' +
      '"citation": {"quote": "the bill is "unworkable" as drafted"}}]}';
    const { service, db } = build({ llmText: unescaped });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.summarize('m-1')).resolves.toBe('created');
    const data = db.minutes.update.mock.calls[0][0].data;
    expect(data.summaryClaims[0].citation.quote).toBe(
      'the bill is "unworkable" as drafted',
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('needed repair'));
    warn.mockRestore();
  });

  it('never logs the text a parse failed on', async () => {
    // V8's "Unexpected token" message quotes ~20 characters of its input, and
    // the input is the minutes quoted verbatim: a public commenter's name
    // would reach a `warn` line production emits.
    const trailingComma =
      '{"summary": "The Assembly met.", "claims": [{"kind": "public_comment", ' +
      '"title": "Testimony", "detail": "", ' +
      '"citation": {"quote": "Jane Resident of Elm Street spoke"}},]}';
    const { service } = build({ llmText: trailingComma });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.summarize('m-1')).resolves.toBe('created');
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('needed repair (commas)');
    expect(logged).not.toMatch(/Elm Street|spoke/);
    warn.mockRestore();
  });

  it('logs a failed write by its kind, never its message', async () => {
    // A Prisma validation error prints the write's arguments, and the write
    // carries the summary and claims, which quote the minutes verbatim.
    const { service, db } = build();
    db.minutes.update.mockRejectedValueOnce(
      Object.assign(
        new Error('Invalid `update()`: summary: "Jane Resident spoke"'),
        { name: 'PrismaClientValidationError' },
      ),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.summarize('m-1')).resolves.toBe('failed');
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('PrismaClientValidationError');
    expect(logged).not.toContain('Jane Resident');
    warn.mockRestore();
  });

  it('refuses to persist when the LLM output has no parseable summary', async () => {
    const { service, db } = build({ llmText: 'not json at all' });
    await expect(service.summarize('m-1')).resolves.toBe('failed');
    expect(db.minutes.update).not.toHaveBeenCalled();
  });
});

describe('MinutesSummaryService — claim dual-write (#1293)', () => {
  beforeEach(() => {
    recordClaimsMock.mockClear();
    recordClaimsMock.mockResolvedValue({ written: 0, byState: {} });
  });

  it('mirrors the surviving claims into the evidence graph', async () => {
    const { service } = build();

    await service.summarize('m-1');

    // Asserting the call, not merely that the code exists. Three separate
    // failures in this milestone were dual-writes that typechecked, passed
    // their unit tests and wrote nothing.
    expect(recordClaimsMock).toHaveBeenCalledTimes(1);
    const input = recordClaimsMock.mock.calls[0][1];
    expect(input.subjectType).toBe('minutes');
    expect(input.subjectId).toBe('m-1');
    // Same drops the blob got — one valid claim of the three offered.
    expect(input.claims).toHaveLength(1);
    expect(input.claims[0].text).toBe('Voted 5-2 to advance AB 1234');
    expect(input.claims[0].citation.quotedText).toBe(
      'voted 5-2 to advance AB 1234',
    );
  });

  it('binds the verdict to the exact rawText it checked', async () => {
    const { service } = build();

    await service.summarize('m-1');

    const input = recordClaimsMock.mock.calls[0][1];
    expect(input.sourceText).toBe(MINUTES_ROW.rawText);
    // `Minutes` stores no hash of rawText (#1279 covered propositions only),
    // so hashing here is what makes a stale summary detectable later at all.
    expect(input.sourceTextHash).toBe(
      createHash('sha256').update(MINUTES_ROW.rawText, 'utf8').digest('hex'),
    );
  });

  it('keeps the summary when the dual-write fails', async () => {
    recordClaimsMock.mockRejectedValue(new Error('evidence table is gone'));
    const { service, db } = build();

    const outcome = await service.summarize('m-1');

    // The blob is what citizens read; the mirror is not read by anything yet.
    // Losing the former to a failure of the latter is the wrong trade, and
    // #1294's backfill is what repairs whatever this drops.
    expect(outcome).toBe('created');
    expect(db.minutes.update).toHaveBeenCalledTimes(1);
  });
});

describe('MinutesSummaryService — only its own template (finding M5)', () => {
  it('writes nothing when the prompt-client served the generic fallback', async () => {
    // The template resolves, but what was served is document-analysis-generic
    // (served hash 'h' is the generic hash): `getTemplate`'s fallback.
    const { service, db, llm } = build({
      templateHash: 'minutes-template',
      genericHash: 'h',
    });

    await expect(service.summarize('m-1')).resolves.toBe('failed');
    expect(llm.generate).not.toHaveBeenCalled();
    expect(db.minutes.update).not.toHaveBeenCalled();
  });

  it('writes nothing when it cannot tell a variant from the fallback', async () => {
    // Served hash is neither canonical nor known-generic, and the generic
    // lookup failed: fail closed, as on a missing template.
    const { service, db, getPromptHash } = build({ templateHash: 'canonical' });
    getPromptHash.mockImplementation((name: string) =>
      name === MINUTES_SUMMARY_TEMPLATE
        ? Promise.resolve('canonical')
        : Promise.reject(new Error('prompt-service down')),
    );

    await expect(service.summarize('m-1')).resolves.toBe('failed');
    expect(db.minutes.update).not.toHaveBeenCalled();
  });

  it('writes an A/B variant, which is served under its own hash', async () => {
    // `getPromptHash` reports the canonical template; a variant is served
    // with the variant's hash. Neither is the generic one, so it is this
    // template working, not the fallback.
    const { service, db } = build({
      templateHash: 'canonical',
      genericHash: 'g',
    });

    await expect(service.summarize('m-1')).resolves.toBe('created');
    expect(db.minutes.update.mock.calls[0][0].data.summaryPromptHash).toBe('h');
  });

  it('writes nothing when the template does not exist', async () => {
    // From 2026-09-13 to this fix: no such template anywhere, so the hash
    // lookup fails and every summary came from the generic prompt.
    const { service, db, llm } = build({
      templateHash: new Error('Prompt template not found'),
    });

    await expect(service.summarize('m-1')).resolves.toBe('failed');
    expect(llm.generate).not.toHaveBeenCalled();
    expect(db.minutes.update).not.toHaveBeenCalled();
  });
});

describe('MinutesSummaryService.selectStale', () => {
  it('returns the stale rows with their skip keys, and counts the rest', async () => {
    const current = { ...(await summarizedRow()), id: 'm-current' };
    const stale = { ...MINUTES_ROW, id: 'm-stale', summary: 'old' };
    const empty = { ...MINUTES_ROW, id: 'm-empty', rawText: '  ' };
    const { service, db } = build({ findMany: [current, stale, empty] });

    const result = await service.selectStale();

    // Every active row with text, not only what this sync wrote: the ingest
    // skips PDFs it has seen, and a prompt change stales those too.
    expect(db.minutes.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      rawText: { not: null },
    });
    // No text: nothing to generate from, so neither pending nor current.
    expect(result!.current).toBe(1);
    expect(result!.pending).toEqual([
      { id: 'm-stale', key: expect.stringMatching(/\S/) },
    ]);
  });

  it('stamps a legacy summary current and leaves it out of pending', async () => {
    // The first sync after deploy: attributed rows with no input/config axes.
    const legacy = {
      ...(await summarizedRow()),
      summarySourceHash: null,
      summaryConfigHash: null,
    };
    const { service, db } = build({ findMany: [legacy] });

    const result = await service.selectStale();

    expect(result).toEqual({ pending: [], current: 1 });
    expect(db.minutes.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: {
        summarySourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        summaryConfigHash: expect.any(String),
      },
    });
  });

  it('keys a job on the live prompt: a new template is a new job id', async () => {
    const stale = [{ ...MINUTES_ROW, id: 'm-stale' }];
    const keyUnder = async (templateHash: string) =>
      (await build({ findMany: stale, templateHash }).service.selectStale())!
        .pending[0].key;

    const first = await keyUnder('h');
    expect(first).toEqual(await keyUnder('h'));
    expect(first).not.toEqual(await keyUnder('h2'));
  });

  it('reads the rows a page at a time', async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...MINUTES_ROW,
        id: `m-${String(from + i).padStart(3, '0')}`,
      }));
    const { service, db } = build();
    db.minutes.findMany
      .mockResolvedValueOnce(page(50, 0))
      .mockResolvedValueOnce(page(3, 50));

    const result = await service.selectStale();

    expect(result!.pending).toHaveLength(53);
    expect(db.minutes.findMany).toHaveBeenCalledTimes(2);
    expect(db.minutes.findMany.mock.calls[1][0]).toMatchObject({
      where: { id: { gt: 'm-049' } },
      take: 50,
    });
  });

  it('is undefined, not "nothing stale", when the summarizer is unconfigured', async () => {
    await expect(new MinutesSummaryService().selectStale()).resolves.toBe(
      undefined,
    );
  });

  it('gives a one-off id when the prompt hash cannot be resolved', async () => {
    const { service } = build({
      findMany: [{ ...MINUTES_ROW, id: 'm-stale' }],
      templateHash: new Error('prompt-service down'),
    });

    const result = await service.selectStale();

    expect(result!.pending).toEqual([{ id: 'm-stale', key: null }]);
  });
});
