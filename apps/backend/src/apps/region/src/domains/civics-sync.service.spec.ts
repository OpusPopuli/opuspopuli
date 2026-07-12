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

    return { service: module.get(CivicsSyncService), mockLlm };
  };

  const makeHelpers = (): jest.Mocked<CivicsCrawlHelpers> => ({
    fetchUrlText: jest.fn(),
    htmlToReadableText: jest.fn(),
    crawlCivicsUrls: jest.fn().mockResolvedValue([]),
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
