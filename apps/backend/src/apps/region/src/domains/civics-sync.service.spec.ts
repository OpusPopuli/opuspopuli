import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import {
  PromptClientService,
  type CivicsExtractionParams,
} from '@opuspopuli/prompt-client';
import { stableHash, type ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { FetchedBytes } from './resilient-fetch';
import { SourceVersionService } from './source-version.service';

import {
  CIVICS_MAX_OUTPUT_TOKENS,
  CIVICS_EXTRACTOR_VERSION,
  CivicsSyncService,
  civicsConfigHash,
  civicsSourceFields,
  type CivicsCrawlHelpers,
  type CivicsProvider,
} from './civics-sync.service';
import { CivicsExtractQueue } from './civics-extract.queue';
import { PipelineJobService } from './pipeline-job.service';
import { SyncAbortedError } from './sync-phase-logger';
import {
  inlineBatch,
  type ChildJobBatch,
} from 'src/common/child-jobs/child-job-batch';

/**
 * Regression coverage for #869: `llm` is an interface (`ILLMProvider`) and is
 * therefore erased at runtime, so it must be injected by the explicit
 * explicit token that `LLMModule` provides. The original code declared
 * `@Optional() private readonly llm?: ILLMProvider` WITHOUT `@Inject`, so
 * NestJS resolved it to `undefined` and every civics sync silently no-op'd at
 * the "requires PromptClient and LLM provider" guard — returning immediately
 * with zero rows even when a region had civics data sources configured.
 *
 * These tests compile the service through a real DI container so the wiring
 * (not just the guard logic) is exercised.
 */
describe('CivicsSyncService', () => {
  const buildService = async (
    opts: { withLlm?: boolean; extra?: unknown[] } = {},
  ) => {
    const { withLlm = true, extra = [] } = opts;

    const mockPromptClient = createMock<PromptClientService>();
    const mockLlm = {
      generate: jest.fn(),
      getModelName: jest.fn().mockReturnValue('qwen-test'),
      // #1281: the weights behind the tag, resolved by the provider.
      getModelDigest: jest.fn().mockResolvedValue('stub-digest'),
    } as unknown as jest.Mocked<ILLMProvider>;
    const mockDb = createMock<DbService>();
    // An archive that hands back what it was given (civics S3): no queue is
    // bound here, so extraction runs inline and reloads the page by id.
    const archived = new Map<string, Buffer>();
    const mockSourceVersions = {
      record: jest.fn(async ({ content }: { content: Buffer }) => {
        const id = `sv-${archived.size + 1}`;
        archived.set(id, content);
        return { contentHash: 'h', stored: true, sourceVersionId: id };
      }),
      getById: jest.fn(async (id: string) =>
        archived.has(id) ? { id, content: archived.get(id) } : null,
      ),
      attachDerivedText: jest.fn().mockResolvedValue(true),
    };

    const providers: unknown[] = [
      CivicsSyncService,
      { provide: DbService, useValue: mockDb },
      { provide: PromptClientService, useValue: mockPromptClient },
      { provide: SourceVersionService, useValue: mockSourceVersions },
    ];
    if (withLlm) {
      // The INGESTION token, not the shared one (roadmap §6.4): civics
      // extraction pulls structured facts out of scraped pages, which is the
      // other half of the job-1 workload alongside structural analysis. The
      // #869 hazard is unchanged by the rename — an interface is still erased
      // at runtime, so the token must still be explicit.
      providers.push({ provide: 'LLM_INGESTION_PROVIDER', useValue: mockLlm });
    }
    providers.push(...extra);

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(CivicsSyncService),
      mockLlm,
      mockDb,
      mockPromptClient,
      mockSourceVersions,
    };
  };

  /** A fetched page whose readable text is `readable text`. */
  const fetched = (html = '<p>readable text</p>'): FetchedBytes => ({
    body: Buffer.from(html, 'utf8'),
    contentType: 'text/html',
    fetchedAt: '2026-10-24T00:00:00.000Z',
  });

  const makeHelpers = (): jest.Mocked<CivicsCrawlHelpers> => ({
    fetchUrlBytes: jest.fn(),
    crawlCivicsUrls: jest.fn().mockResolvedValue([]),
  });

  /**
   * Drive exactly one civics page end-to-end through `sync()` with the LLM
   * returning `extractedJson`. Returns the sync result plus the db mock so a
   * test can assert whether the block was persisted.
   */
  const drivePage = async (
    extractedJson: string,
    generateExtras: Record<string, unknown> = {},
    sourceOverrides: Record<string, unknown> = {},
  ) => {
    const { service, mockLlm, mockDb, mockPromptClient } = await buildService();
    mockPromptClient.getCivicsExtractionPrompt.mockResolvedValue({
      promptText: 'prompt',
      promptHash: 'hash',
      promptVersion: '1.0.0',
    } as never);
    mockLlm.generate.mockResolvedValue({
      text: extractedJson,
      ...generateExtras,
    } as never);
    (mockDb.civicsBlock.findUnique as jest.Mock).mockResolvedValue(null);

    const sourceUrl = 'https://www.assembly.ca.gov/resources/x';
    const getDataSources = jest.fn().mockReturnValue([
      {
        url: sourceUrl,
        contentGoal: 'goal',
        category: 'Assembly',
        ...sourceOverrides,
      },
    ]);
    const plugin = {
      getName: () => 'california',
      getDataSources,
    } as unknown as CivicsProvider;

    const helpers: jest.Mocked<CivicsCrawlHelpers> = {
      fetchUrlBytes: jest.fn().mockResolvedValue(fetched()),
      crawlCivicsUrls: jest.fn().mockResolvedValue([sourceUrl]),
    };

    const result = await service.sync(plugin, helpers);
    return { result, mockDb, mockLlm };
  };

  /** drivePage with data-source fields set — for the config-contradiction checks. */
  const drivePageWithSource = (
    extractedJson: string,
    sourceOverrides: Record<string, unknown>,
  ) => drivePage(extractedJson, {}, sourceOverrides);

  // ── #874: don't persist empty CivicsBlocks ────────────────────────────
  const EMPTY_BLOCK = JSON.stringify({
    chambers: [],
    measureTypes: [],
    lifecycleStages: [],
    glossary: [],
    sessionScheme: null,
  });

  it('skips the upsert when the extracted block has no civic content (#874)', async () => {
    const { result, mockDb } = await drivePage(EMPTY_BLOCK);

    expect(mockDb.civicsBlock.upsert).not.toHaveBeenCalled();
    // A skipped page counts as neither processed nor created/updated.
    expect(result).toEqual({
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 1,
    });
  });

  // ── #1335: an empty extraction over an EXISTING block ──────────────────
  //
  // #874 established that an empty extraction must not CREATE a noise row.
  // That check ran before anything knew whether a row already existed, so
  // "this page has no civic content" and "this page used to have content and
  // now extracts none" were the same code path and the same `log` line.
  //
  // The second case is a problem: keeping the row is right, but its prompt
  // provenance stops matching its siblings. Measured 2026-10-07 — one of twelve
  // California pages sat on prompt v5 while eleven moved to v6, because two
  // later successful syncs passed over it and said nothing.
  describe('empty extraction over an existing block (#1335)', () => {
    /** drivePage, but with a row already present for the page. */
    const driveOverExisting = async (
      extractedJson: string,
      existing: Record<string, unknown> = {
        id: 'block-1',
        promptVersion: 'v5',
        extractedAt: new Date('2026-10-06T21:26:06Z'),
      },
    ) => {
      const { service, mockLlm, mockDb, mockPromptClient } =
        await buildService();
      mockPromptClient.getCivicsExtractionPrompt.mockResolvedValue({
        promptText: 'prompt',
        promptHash: 'hash',
        promptVersion: 'v6',
      } as never);
      mockLlm.generate.mockResolvedValue({ text: extractedJson } as never);
      (mockDb.civicsBlock.findUnique as jest.Mock).mockResolvedValue(existing);

      const sourceUrl =
        'https://www.sos.ca.gov/elections/ballot-measures/how-qualify-initiative';
      const plugin = {
        getName: () => 'california',
        getDataSources: jest
          .fn()
          .mockReturnValue([
            { url: sourceUrl, contentGoal: 'goal', category: 'SoS' },
          ]),
      } as unknown as CivicsProvider;
      const helpers: jest.Mocked<CivicsCrawlHelpers> = {
        fetchUrlBytes: jest.fn().mockResolvedValue(fetched()),
        crawlCivicsUrls: jest.fn().mockResolvedValue([sourceUrl]),
      };

      const result = await service.sync(plugin, helpers);
      return { result, mockDb, sourceUrl };
    };

    afterEach(() => jest.restoreAllMocks());

    it('keeps the existing row rather than deleting or blanking it', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { mockDb } = await driveOverExisting(EMPTY_BLOCK);

      // Serving the last good extraction beats serving nothing.
      expect(mockDb.civicsBlock.upsert).not.toHaveBeenCalled();
      expect(mockDb.civicsBlock.delete).not.toHaveBeenCalled();
    });

    it('warns, naming the provenance drift', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await driveOverExisting(EMPTY_BLOCK);

      const perPage = warn.mock.calls.find((c) =>
        JSON.stringify(c).includes('extracted EMPTY over an existing'),
      );
      expect(perPage).toBeDefined();
      const meta = perPage![0] as Record<string, unknown>;
      expect(meta.storedPromptVersion).toBe('v5');
      expect(meta.livePromptVersion).toBe('v6');
      expect(meta.promptVersionDrifted).toBe(true);
    });

    /**
     * The per-page warning is easy to lose in a long sync, and the aggregate is
     * the thing worth noticing — the job still reports success either way.
     */
    it('warns once per run with the stale count against what was written', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await driveOverExisting(EMPTY_BLOCK);

      const summary = warn.mock.calls.find((c) =>
        JSON.stringify(c).includes('existing block(s) that extracted empty'),
      );
      expect(summary).toBeDefined();
      expect((summary![0] as Record<string, unknown>).stale).toBe(1);
      expect((summary![0] as Record<string, unknown>).written).toBe(0);
    });

    it('does not count the page as processed, created or updated', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { result } = await driveOverExisting(EMPTY_BLOCK);

      expect(result).toEqual({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 1,
      });
    });

    /**
     * The benign case must stay quiet. Warning on every genuinely content-free
     * page — dining services, records-request forms — would be noise, and noise
     * is what let the real case hide.
     */
    it('stays at log level when there is no existing row', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await drivePage(EMPTY_BLOCK);

      expect(
        warn.mock.calls.find((c) =>
          JSON.stringify(c).includes('extracted EMPTY over an existing'),
        ),
      ).toBeUndefined();
      expect(
        warn.mock.calls.find((c) =>
          JSON.stringify(c).includes('existing block(s) that extracted empty'),
        ),
      ).toBeUndefined();
    });

    /** A non-empty extraction over an existing row must still update it. */
    it('still updates normally when the extraction has content', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { result, mockDb } = await driveOverExisting(
        JSON.stringify({
          chambers: [{ name: 'Assembly', abbreviation: 'A' }],
          measureTypes: [],
          lifecycleStages: [],
          glossary: [],
          sessionScheme: null,
        }),
      );

      expect(mockDb.civicsBlock.upsert).toHaveBeenCalled();
      expect(result).toEqual({
        processed: 1,
        created: 0,
        updated: 1,
        skipped: 0,
      });
    });
  });

  it('persists a block that has any list content (#874)', async () => {
    const { result, mockDb } = await drivePage(
      JSON.stringify({
        chambers: [{ name: 'Assembly' }],
        measureTypes: [],
        lifecycleStages: [],
        glossary: [],
        sessionScheme: null,
      }),
    );

    expect(mockDb.civicsBlock.upsert).toHaveBeenCalledTimes(1);
    // #873: the producing model is stamped for provenance on both paths.
    expect(mockDb.civicsBlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ llmModel: 'qwen-test' }),
        update: expect.objectContaining({ llmModel: 'qwen-test' }),
      }),
    );
    expect(result).toEqual({
      processed: 1,
      created: 1,
      updated: 0,
      skipped: 0,
    });
  });

  it('stamps the full attribution set from the base class (#1281)', async () => {
    // CivicsSyncService used to only MIRROR LlmGeneratorBase's constructor and
    // assemble its own stamp. That is how it ended up carrying llmModel but
    // would not have picked up the digest: an addition to the attribution set
    // reached every generator that inherited, and not this one. It now
    // inherits, so the set arrives here by construction.
    const { mockDb } = await drivePage(
      JSON.stringify({
        chambers: [{ name: 'Assembly' }],
        measureTypes: [],
        lifecycleStages: [],
        glossary: [],
        sessionScheme: null,
      }),
    );

    expect(mockDb.civicsBlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          promptHash: 'hash',
          llmModel: 'qwen-test',
          llmDigest: 'stub-digest',
        }),
        update: expect.objectContaining({
          llmModel: 'qwen-test',
          llmDigest: 'stub-digest',
        }),
      }),
    );
  });

  it('persists a block whose only content is the session scheme (#874)', async () => {
    // Mirrors real CA pages that yielded only sessionScheme — must NOT be
    // treated as empty.
    const { result, mockDb } = await drivePage(
      JSON.stringify({
        chambers: [],
        measureTypes: [],
        lifecycleStages: [],
        glossary: [],
        sessionScheme: { cadence: 'biennial' },
      }),
    );

    expect(mockDb.civicsBlock.upsert).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      processed: 1,
      created: 1,
      updated: 0,
      skipped: 0,
    });
  });

  it('receives the LLM provider via the LLM_INGESTION_PROVIDER token and gets past the guard (#869)', async () => {
    const { service } = await buildService({ withLlm: true });
    // A plugin whose dataSources are empty lets us stop right after the guard
    // without any crawling — the assertion is simply that getDataSources IS
    // consulted, which only happens once the llm/promptClient guard passes.
    const getDataSources = jest.fn().mockReturnValue([]);
    const plugin: CivicsProvider = {
      getName: () => 'california',
      getDataSources,
    };

    const result = await service.sync(plugin, makeHelpers());

    // Under the injection bug, llm was undefined → guard short-circuited and
    // getDataSources was NEVER called. Passing the guard proves the fix.
    expect(getDataSources).toHaveBeenCalledWith(expect.anything());
    expect(result).toEqual({
      processed: 0,
      created: 0,
      updated: 0,
    });
  });

  it('no-ops when the LLM provider is absent (guard still protects a mis-wired node)', async () => {
    const { service } = await buildService({ withLlm: false });
    const getDataSources = jest.fn().mockReturnValue([]);
    const plugin: CivicsProvider = {
      getName: () => 'california',
      getDataSources,
    };

    const result = await service.sync(plugin, makeHelpers());

    expect(getDataSources).not.toHaveBeenCalled();
    expect(result).toEqual({
      processed: 0,
      created: 0,
      updated: 0,
    });
  });

  describe('CivicsSyncService — output budget and determinism', () => {
    /**
     * Verified by reintroducing the bug: restore the old inline 32000 and this
     * fails. That value is what cut off a complete 211-term glossary extraction
     * mid-string on 2026-09-24.
     */
    const ANY_CONTENT = JSON.stringify({
      chambers: [{ name: 'Assembly' }],
      measureTypes: [],
      lifecycleStages: [],
      glossary: [],
      sessionScheme: null,
    });

    it('sends a budget big enough for a glossary page, and no seed by default', async () => {
      const { mockLlm } = await drivePage(ANY_CONTENT);

      expect(mockLlm.generate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTokens: CIVICS_MAX_OUTPUT_TOKENS }),
      );
      // Unseeded on purpose. A fixed seed would make a page that extracts on
      // roughly half its attempts fail on all three BullMQ attempts, and on
      // every cron run after that — the same roll, forever.
      expect(
        (mockLlm.generate as jest.Mock).mock.calls[0][1],
      ).not.toHaveProperty('seed');
    });

    /**
     * The contradiction that shipped on 2026-09-24: a budget needing ~47 min
     * paired with a 22-minute timeout. A page using the full budget aborts
     * rather than truncates, and the abort path captures nothing.
     */
    it('warns when a source budget cannot fit its own timeout', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        // 64,000 tokens at 22.5 tok/s is ~47 min; this source allows 22.
        await drivePageWithSource(ANY_CONTENT, {
          llmMaxTokens: 64000,
          llmRequestTimeoutMs: 1_320_000,
        });
        const messages = warn.mock.calls.map((c) => String(c[1] ?? c[0]));
        const hit = messages.find((m) =>
          m.includes('cannot satisfy both of its own limits'),
        );
        expect(hit).toBeDefined();
        expect(hit).toContain('will ABORT rather than truncate');
      } finally {
        warn.mockRestore();
      }
    });

    it('stays quiet when the timeout can accommodate the budget', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        await drivePageWithSource(ANY_CONTENT, {
          llmMaxTokens: 64000,
          llmRequestTimeoutMs: 3_600_000, // 60 min — the #1329 value
        });
        const messages = warn.mock.calls.map((c) => String(c[1] ?? c[0]));
        expect(messages.some((m) => m.includes('cannot satisfy both'))).toBe(
          false,
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('pins the seed only when an operator asks for a reproducible run', async () => {
      process.env.CIVICS_EXTRACTION_SEED = '7';
      try {
        const { mockLlm } = await drivePage(ANY_CONTENT);

        expect(mockLlm.generate).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ seed: 7 }),
        );
      } finally {
        delete process.env.CIVICS_EXTRACTION_SEED;
      }
    });

    it('ignores a seed that is not a plain number', async () => {
      process.env.CIVICS_EXTRACTION_SEED = 'random';
      try {
        const { mockLlm } = await drivePage(ANY_CONTENT);

        expect(
          (mockLlm.generate as jest.Mock).mock.calls[0][1],
        ).not.toHaveProperty('seed');
      } finally {
        delete process.env.CIVICS_EXTRACTION_SEED;
      }
    });

    /**
     * The two ways `extractJsonObjectSlice` returns nothing are opposite
     * problems, and telling them apart is the whole point: one is a budget to
     * raise, the other is a prompt or model to fix. Reporting both as "no JSON
     * object" is what turned the ceiling into a two-day mystery written up as a
     * "32,000-token runaway".
     */
    describe('distinguishes a cut-off extraction from a bad one', () => {
      const TRUNCATED =
        '{"chambers": [], "glossary": [{"term": "Across the Desk"';

      it('names the ceiling, the size and the fix when it was cut off', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        try {
          await drivePage(TRUNCATED, { finishReason: 'length' });
          const messages = warn.mock.calls.map((c) => String(c[1] ?? c[0]));
          const hit = messages.find((m) => m.includes('TRUNCATED'));
          expect(hit).toBeDefined();
          expect(hit).toContain(String(CIVICS_MAX_OUTPUT_TOKENS));
          expect(hit).toContain('llmMaxTokens');
          // Must NOT read as malformed output — that is the misdiagnosis.
          expect(hit).not.toContain('no JSON object');
        } finally {
          warn.mockRestore();
        }
      });

      /**
       * A balanced-brace slice that still will not parse — a bad escape inside a
       * string. Distinct from both the ceiling and the no-object case, and until
       * 2026-09-24 the only branch that captured nothing, which is why the two
       * occurrences that day could not be diagnosed.
       */
      it('captures the response when the JSON is complete but invalid', async () => {
        // Asserted by the FILES, not by the log line. A first version of this
        // test checked only the message and passed with the capture call deleted
        // — which is the failure mode it exists to prevent.
        const dir = mkdtempSync(join(tmpdir(), 'civics-capture-'));
        process.env.CIVICS_CAPTURE_DIR = dir;
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        try {
          // Balanced braces, invalid escape: extractJsonObjectSlice returns it,
          // JSON.parse rejects it.
          await drivePage('{"glossary": [{"term": "Bad \\x41 escape"}]}', {
            finishReason: 'stop',
          });
          const messages = warn.mock.calls.map((c) => String(c[1] ?? c[0]));
          const hit = messages.find((m) => m.includes('JSON.parse failed'));
          expect(hit).toBeDefined();
          expect(hit).toContain('bad escape');
          expect(hit).toContain('Not a budget problem');
          // The structured payload must carry the offending bytes, not just the
          // error string — the bytes are the whole question.
          const payload = warn.mock.calls.find((c) =>
            String(c[1] ?? '').includes('JSON.parse failed'),
          )?.[0] as Record<string, unknown> | undefined;
          expect(payload).toMatchObject({ parseError: expect.any(String) });
          expect(payload).toHaveProperty('around');

          // The prompt and the raw response must be on disk, or the failure is
          // undiagnosable after the fact — the whole point.
          const written = readdirSync(dir).sort();
          expect(written).toHaveLength(2);
          expect(written.some((f) => f.endsWith('.prompt.txt'))).toBe(true);
          expect(written.some((f) => f.endsWith('.response.txt'))).toBe(true);
        } finally {
          warn.mockRestore();
          delete process.env.CIVICS_CAPTURE_DIR;
          rmSync(dir, { recursive: true, force: true });
        }
      });

      it('says it is a model or prompt problem when the model simply stopped', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        try {
          await drivePage('I could not find any civic information.', {
            finishReason: 'stop',
          });
          const messages = warn.mock.calls.map((c) => String(c[1] ?? c[0]));
          const hit = messages.find((m) => m.includes('no JSON object'));
          expect(hit).toBeDefined();
          expect(hit).toContain('Not a budget problem');
          expect(hit).not.toContain('TRUNCATED');
        } finally {
          warn.mockRestore();
        }
      });
    });
  });
});

/**
 * The failure that cost a day said only "no JSON object" and a character
 * count. That cannot distinguish the two possibilities — the model wrote
 * prose instead of JSON, or it was still writing valid JSON when it hit the
 * token ceiling — and they have opposite fixes.
 *
 * `finishReason` answers it outright, and was already on the result and
 * discarded.
 */
describe('CivicsSyncService — failure diagnostics (#1319)', () => {
  it('captures nothing to disk unless an operator opts in', () => {
    // The prompt embeds scraped civic text, which under #1263 can carry
    // proponent contact details. Logs are shipped, indexed and retained; a
    // file written only on request is not. Default must be off.
    expect(process.env.CIVICS_CAPTURE_DIR).toBeUndefined();
  });
});

describe('civicsConfigHash — what a page skip must notice (K1)', () => {
  /**
   * Every input of the civics prompt, and how a skip covers it. Typed as a
   * Record over the prompt's own params, so adding an input to
   * `CivicsExtractionParams` fails to COMPILE here until someone decides how
   * the skip key covers it — an unhashed prompt input is a stale skip.
   */
  const COVERED: Record<
    keyof CivicsExtractionParams,
    'row' | 'text' | 'config'
  > = {
    regionId: 'row', // the skip record is per (region, page)
    sourceUrl: 'row',
    html: 'text', // sourceHash
    contentGoal: 'config',
    category: 'config',
    hints: 'config',
  };

  const base = {
    url: 'https://www.senate.ca.gov/citizens-guide',
    contentGoal: 'how a bill becomes law',
    category: 'Senate',
    hints: ['Senate rules'],
    llmMaxTokens: 64000,
  };
  const changed: Record<string, unknown> = {
    contentGoal: 'something else',
    category: 'Assembly',
    hints: ['Assembly rules'],
  };

  it.each(
    Object.entries(COVERED)
      .filter(([, how]) => how === 'config')
      .map(([field]) => field),
  )('changes when the prompt input %s changes', (field) => {
    expect(
      civicsConfigHash({ ...base, [field]: changed[field] } as never),
    ).not.toBe(civicsConfigHash(base as never));
  });

  it('changes when the output budget changes', () => {
    expect(civicsConfigHash({ ...base, llmMaxTokens: 8000 } as never)).not.toBe(
      civicsConfigHash(base as never),
    );
  });

  it('hashes the EFFECTIVE budget — unset equals the code default', () => {
    const unset: Record<string, unknown> = { ...base };
    delete unset.llmMaxTokens;
    expect(civicsConfigHash(unset as never)).toBe(
      civicsConfigHash({
        ...base,
        llmMaxTokens: CIVICS_MAX_OUTPUT_TOKENS,
      } as never),
    );
  });

  it('includes the extractor version, so a post-processing fix reaches unchanged pages', () => {
    // Bumping CIVICS_EXTRACTOR_VERSION must change every page's key.
    expect(civicsConfigHash(base as never)).toBe(
      stableHash({
        extractor: CIVICS_EXTRACTOR_VERSION,
        contentGoal: base.contentGoal,
        category: base.category,
        hints: base.hints,
        llmMaxTokens: base.llmMaxTokens,
      }),
    );
  });

  it('ignores config that only changes which pages are crawled', () => {
    expect(
      civicsConfigHash({ ...base, crawlDepth: 3, crawlMaxPages: 50 } as never),
    ).toBe(civicsConfigHash(base as never));
  });
});

// ── Civics S3: the fetch half, the queue, and the worker's job ─────────
describe('CivicsSyncService — extraction off the fetch loop (S3)', () => {
  const BLOCK = JSON.stringify({ chambers: [{ name: 'Senate' }] });
  const PAGE = 'https://www.senate.ca.gov/citizens-guide/process';
  const OTHER = 'https://www.senate.ca.gov/citizens-guide/other';

  const plugin = (sources: Record<string, unknown>[]) =>
    ({
      getName: () => 'california',
      getDataSources: () => sources,
    }) as unknown as CivicsProvider;
  const source = { url: PAGE, contentGoal: 'goal', category: 'Senate' };
  const page = (): Buffer => Buffer.from('<p>A bill is introduced.</p>');

  /** A service with the archive, the LLM and the prompt stubbed. */
  const build = async (extra: unknown[] = []) => {
    const archived = new Map<string, Buffer>();
    const sourceVersions = {
      record: jest.fn(async ({ content }: { content: Buffer }) => {
        const id = `sv-${archived.size + 1}`;
        archived.set(id, content);
        return { contentHash: 'h', stored: true, sourceVersionId: id };
      }),
      getById: jest.fn(async (id: string) =>
        archived.has(id) ? { id, content: archived.get(id) } : null,
      ),
      attachDerivedText: jest.fn().mockResolvedValue(true),
    };
    const llm = {
      generate: jest.fn().mockResolvedValue({ text: BLOCK }),
      getModelName: () => 'm',
      getModelDigest: jest.fn().mockResolvedValue('d'),
    };
    const prompt = createMock<PromptClientService>();
    prompt.getCivicsExtractionPrompt.mockResolvedValue({
      promptText: 'p',
      promptHash: 'h',
      promptVersion: 'v6',
    } as never);
    const db = createMock<DbService>();
    (db.civicsBlock.findUnique as jest.Mock).mockResolvedValue(null);
    (db.civicsPageExtraction.findUnique as jest.Mock).mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        CivicsSyncService,
        { provide: DbService, useValue: db },
        { provide: PromptClientService, useValue: prompt },
        { provide: 'LLM_INGESTION_PROVIDER', useValue: llm },
        { provide: SourceVersionService, useValue: sourceVersions },
        ...(extra as never[]),
      ],
    }).compile();
    return { service: module.get(CivicsSyncService), llm, sourceVersions, db };
  };

  const helpers = (
    urls: string[],
    fetchUrlBytes: CivicsCrawlHelpers['fetchUrlBytes'] = async () => ({
      body: page(),
      contentType: 'text/html',
      fetchedAt: '2026-10-24T00:00:00.000Z',
    }),
  ): CivicsCrawlHelpers => ({
    crawlCivicsUrls: async () => urls,
    fetchUrlBytes,
  });

  /** A queue whose batch is `batch`, standing in for Redis. */
  const queueOf = (batch: ChildJobBatch<unknown, string>) => ({
    provide: CivicsExtractQueue,
    useValue: { enabled: true, open: jest.fn().mockResolvedValue(batch) },
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('archives each page and writes the block against that archived copy', async () => {
    const { service, sourceVersions, db } = await build();

    await service.sync(plugin([source]), helpers([PAGE]));

    expect(sourceVersions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: PAGE,
        dataType: 'civics',
        contentType: 'text/html',
      }),
    );
    expect(db.civicsBlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceVersionId: 'sv-1' }),
      }),
    );
    expect(sourceVersions.attachDerivedText).toHaveBeenCalledWith(
      'sv-1',
      'A bill is introduced.',
    );
  });

  it('extracts a page reached by two sources with identical inputs once, counting both', async () => {
    // A queue whose jobs report only once the parent waits — the second
    // source reaches the page while its job is still in flight.
    const ids: string[] = [];
    let added = 0;
    let released = false;
    const inFlight: ChildJobBatch<unknown, string> = {
      add: async (_d, id) => {
        added++;
        ids.push(id);
      },
      take: () =>
        released
          ? ids
              .splice(0)
              .map((jobId) => ({ jobId, ok: true as const, value: 'created' }))
          : [],
      get pending() {
        return ids.length;
      },
      waitForOutcome: async () => {
        released = true;
      },
      dropWaiting: async () => 0,
      failPending: async () => undefined,
      close: async () => undefined,
    };
    const { service } = await build([queueOf(inFlight)]);

    const result = await service.sync(
      plugin([source, { ...source }]),
      helpers([PAGE]),
    );

    expect(added).toBe(1);
    expect(result.created).toBe(2);
  });

  it('counts a page it could not queue as failed, and carries on', async () => {
    const batch = inlineBatch(async () => 'created');
    let calls = 0;
    const { service } = await build([
      queueOf({
        ...batch,
        add: async (d, id) => {
          if (calls++ === 0) throw new Error('redis down');
          return batch.add(d, id);
        },
      }),
    ]);

    const result = await service.sync(plugin([source]), helpers([PAGE, OTHER]));

    expect(result).toMatchObject({ created: 1, processed: 1 });
  });

  it('counts a job result it does not recognise as a failure', async () => {
    // As failures they trip the consecutive-failure abort; counted as
    // anything else they would not.
    const { service } = await build([
      queueOf(inlineBatch(async () => 'exploded')),
    ]);
    const urls = Array.from({ length: 6 }, (_, i) => `${PAGE}/${i}`);

    await expect(
      service.sync(plugin([source]), helpers(urls)),
    ).rejects.toBeInstanceOf(SyncAbortedError);
  });

  it('archives nothing for a page K1 skips', async () => {
    // The archive dedupes on bytes, K1 on text: a page whose markup churns
    // every request would otherwise add a row every run.
    const { service, sourceVersions, db } = await build();
    const { skipKey } = await (
      service as unknown as {
        pageInputs: (...a: unknown[]) => Promise<{ skipKey: string }>;
      }
    ).pageInputs(
      'california',
      PAGE,
      civicsSourceFields(source as never),
      'A bill is introduced.',
    );
    (db.civicsPageExtraction.findUnique as jest.Mock).mockResolvedValue({
      skipKey,
      outcome: 'empty',
    });

    const result = await service.sync(plugin([source]), helpers([PAGE]));

    expect(result.skipped).toBe(1);
    expect(sourceVersions.record).not.toHaveBeenCalled();
  });

  it('gives a forced run its own job ids, so it never collapses onto an unforced one', async () => {
    const ids: string[] = [];
    const batch = inlineBatch(async () => 'updated');
    const { service } = await build([
      queueOf({ ...batch, add: (d, id) => (ids.push(id), batch.add(d, id)) }),
    ]);

    await service.sync(plugin([source]), helpers([PAGE]));
    await service.sync(plugin([source]), helpers([PAGE]), { reextract: true });

    expect(ids[0]).toMatch(/__extract__/);
    expect(ids[1]).toMatch(/__reextract__/);
    expect(ids[1].replace('reextract', 'extract')).toBe(ids[0]);
  });

  it('stops fetching when the run is cancelled', async () => {
    const fetchBytes = jest.fn();
    const { service } = await build([
      {
        provide: PipelineJobService,
        useValue: { isCancelled: jest.fn().mockResolvedValue(true) },
      },
    ]);

    await service.sync(plugin([source]), helpers([PAGE], fetchBytes), {
      pipelineJobId: 'job-1',
    });

    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('carries on when cancellation cannot be read', async () => {
    const { service, llm } = await build([
      {
        provide: PipelineJobService,
        useValue: { isCancelled: jest.fn().mockRejectedValue(new Error('db')) },
      },
    ]);

    await service.sync(plugin([source]), helpers([PAGE]), {
      pipelineJobId: 'job-1',
    });

    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('fails a page the archive refuses — there is nothing for the worker to reload', async () => {
    const { service, sourceVersions, llm } = await build();
    sourceVersions.record.mockResolvedValueOnce({
      contentHash: 'h',
      stored: false,
      skippedReason: 'too-large',
    } as never);

    const result = await service.sync(plugin([source]), helpers([PAGE]));

    expect(llm.generate).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('fails a page whose fetch throws, without queueing it', async () => {
    const { service, llm } = await build();

    await service.sync(
      plugin([source]),
      helpers([PAGE], async () => {
        throw new Error('HTTP 404');
      }),
    );

    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('aborts after consecutive failures and leaves no job running past it', async () => {
    const dropWaiting = jest.fn().mockResolvedValue(0);
    const batch = inlineBatch(async () => 'failed');
    const { service } = await build([queueOf({ ...batch, dropWaiting })]);
    const urls = Array.from({ length: 6 }, (_, i) => `${PAGE}/${i}`);

    await expect(
      service.sync(plugin([source]), helpers(urls)),
    ).rejects.toBeInstanceOf(SyncAbortedError);
    expect(dropWaiting).toHaveBeenCalled();
  });

  describe('extractPage (the worker job)', () => {
    const job = (sourceVersionId: string) => ({
      regionId: 'california',
      sourceUrl: PAGE,
      sourceVersionId,
      source: civicsSourceFields(source as never),
    });

    it('re-checks the key and skips a page an earlier run finished', async () => {
      const { service, llm, sourceVersions, db } = await build();
      await sourceVersions.record({ content: page() });
      const key = await (
        service as unknown as {
          pageInputs: (...a: unknown[]) => Promise<{ skipKey: string }>;
        }
      ).pageInputs(
        'california',
        PAGE,
        job('sv-1').source,
        'A bill is introduced.',
      );
      (db.civicsPageExtraction.findUnique as jest.Mock).mockResolvedValue({
        skipKey: key.skipKey,
        outcome: 'empty',
      });

      await expect(service.extractPage(job('sv-1'))).resolves.toBe('unchanged');
      expect(llm.generate).not.toHaveBeenCalled();
    });

    it('fails without retrying when its archived page is gone', async () => {
      const { service } = await build();

      await expect(service.extractPage(job('missing'))).resolves.toBe('failed');
    });

    it('throws when it is not wired to run at all', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CivicsSyncService,
          { provide: DbService, useValue: createMock<DbService>() },
        ],
      }).compile();

      await expect(
        module.get(CivicsSyncService).extractPage(job('sv-1')),
      ).rejects.toThrow(/requires/);
    });

    it('hashes the same config from the job as from the data source', () => {
      // The worker rebuilds the key from a JSON round-tripped payload.
      const ds = { ...source, hints: ['a'], crawlDepth: 2 } as never;
      const viaJob = JSON.parse(JSON.stringify(civicsSourceFields(ds)));

      expect(civicsConfigHash(viaJob)).toBe(
        civicsConfigHash(civicsSourceFields(ds)),
      );
    });
  });
});
