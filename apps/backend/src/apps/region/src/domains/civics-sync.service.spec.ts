import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import {
  CivicsSyncService,
  type CivicsCrawlHelpers,
  type CivicsProvider,
} from './civics-sync.service';

/**
 * Regression coverage for #869: `llm` is an interface (`ILLMProvider`) and is
 * therefore erased at runtime, so it must be injected by the explicit
 * `'LLM_PROVIDER'` token that `LLMModule` provides. The original code declared
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
    } as unknown as jest.Mocked<ILLMProvider>;
    const mockDb = createMock<DbService>();

    const providers: unknown[] = [
      CivicsSyncService,
      { provide: DbService, useValue: mockDb },
      { provide: PromptClientService, useValue: mockPromptClient },
    ];
    if (withLlm) {
      providers.push({ provide: 'LLM_PROVIDER', useValue: mockLlm });
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
  const drivePage = async (extractedJson: string) => {
    const { service, mockLlm, mockDb, mockPromptClient } = await buildService();
    mockPromptClient.getCivicsExtractionPrompt.mockResolvedValue({
      promptText: 'prompt',
      promptHash: 'hash',
      promptVersion: '1.0.0',
    } as never);
    mockLlm.generate.mockResolvedValue({ text: extractedJson } as never);
    (mockDb.civicsBlock.findUnique as jest.Mock).mockResolvedValue(null);

    const sourceUrl = 'https://www.assembly.ca.gov/resources/x';
    const getDataSources = jest
      .fn()
      .mockReturnValue([
        { url: sourceUrl, contentGoal: 'goal', category: 'Assembly' },
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
    return { result, mockDb };
  };

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

  it('receives the LLM provider via the LLM_PROVIDER token and gets past the guard (#869)', async () => {
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
});
