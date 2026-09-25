import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import {
  CIVICS_MAX_OUTPUT_TOKENS,
  CivicsSyncService,
  type CivicsCrawlHelpers,
  type CivicsProvider,
} from './civics-sync.service';

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
  const buildService = async (opts: { withLlm?: boolean } = {}) => {
    const { withLlm = true } = opts;

    const mockPromptClient = createMock<PromptClientService>();
    const mockLlm = {
      generate: jest.fn(),
      getModelName: jest.fn().mockReturnValue('qwen-test'),
      // #1281: the weights behind the tag, resolved by the provider.
      getModelDigest: jest.fn().mockResolvedValue('stub-digest'),
    } as unknown as jest.Mocked<ILLMProvider>;
    const mockDb = createMock<DbService>();

    const providers: unknown[] = [
      CivicsSyncService,
      { provide: DbService, useValue: mockDb },
      { provide: PromptClientService, useValue: mockPromptClient },
    ];
    if (withLlm) {
      // The INGESTION token, not the shared one (roadmap §6.4): civics
      // extraction pulls structured facts out of scraped pages, which is the
      // other half of the job-1 workload alongside structural analysis. The
      // #869 hazard is unchanged by the rename — an interface is still erased
      // at runtime, so the token must still be explicit.
      providers.push({ provide: 'LLM_INGESTION_PROVIDER', useValue: mockLlm });
    }

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
    };
  };

  const makeHelpers = (): jest.Mocked<CivicsCrawlHelpers> => ({
    fetchUrlText: jest.fn(),
    htmlToReadableText: jest.fn(),
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
      fetchUrlText: jest.fn().mockResolvedValue('<html/>'),
      htmlToReadableText: jest.fn().mockReturnValue('readable text'),
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
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
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
    expect(result).toEqual({ processed: 1, created: 1, updated: 0 });
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
    expect(result).toEqual({ processed: 1, created: 1, updated: 0 });
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
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
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
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
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
