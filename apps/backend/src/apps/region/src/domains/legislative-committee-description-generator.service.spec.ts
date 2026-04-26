import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';

describe('LegislativeCommitteeDescriptionGeneratorService', () => {
  async function buildService(
    opts: {
      withDeps?: boolean;
      withDb?: boolean;
      configValues?: Record<string, string | undefined>;
      dbRows?: Array<{ id: string; name: string; chamber: string }>;
    } = {},
  ) {
    const {
      withDeps = true,
      withDb = true,
      configValues = {},
      dbRows = [],
    } = opts;

    const mockPromptClient = createMock<PromptClientService>();
    mockPromptClient.getDocumentAnalysisPrompt.mockResolvedValue({
      promptText: 'built prompt',
      promptHash: 'hash',
      promptVersion: '1.0.0',
    });

    const mockLlm = {
      generate: jest.fn(),
    } as unknown as jest.Mocked<ILLMProvider>;

    const mockConfig = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    const mockDb = {
      legislativeCommittee: {
        findMany: jest.fn().mockResolvedValue(dbRows),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as DbService;

    const providers: unknown[] = [
      LegislativeCommitteeDescriptionGeneratorService,
    ];
    if (withDeps) {
      providers.push(
        { provide: ConfigService, useValue: mockConfig },
        { provide: PromptClientService, useValue: mockPromptClient },
        { provide: 'LLM_PROVIDER', useValue: mockLlm },
      );
    }
    if (withDb) {
      providers.push({ provide: DbService, useValue: mockDb });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(LegislativeCommitteeDescriptionGeneratorService),
      promptClient: mockPromptClient,
      llm: mockLlm,
      db: mockDb as DbService & {
        legislativeCommittee: { findMany: jest.Mock; update: jest.Mock };
      },
    };
  }

  describe('when dependencies are unavailable', () => {
    it('returns silently with no db, prompt client, or llm', async () => {
      const built = await buildService({ withDeps: false, withDb: false });
      await expect(
        built.service.generateMissingDescriptions(),
      ).resolves.toBeUndefined();
    });

    it('returns silently when db is wired but prompt client + llm are not', async () => {
      const built = await buildService({ withDeps: false });
      await built.service.generateMissingDescriptions();
      expect(built.db.legislativeCommittee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('candidate selection', () => {
    it('queries only committees missing a description and not soft-deleted', async () => {
      const built = await buildService();
      await built.service.generateMissingDescriptions();
      const findManyArgs =
        built.db.legislativeCommittee.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toMatchObject({
        deletedAt: null,
        description: null,
      });
    });

    it('returns early when no candidates exist', async () => {
      const built = await buildService({ dbRows: [] });
      await built.service.generateMissingDescriptions();
      expect(built.llm.generate).not.toHaveBeenCalled();
      expect(built.db.legislativeCommittee.update).not.toHaveBeenCalled();
    });
  });

  describe('cap handling', () => {
    const three = [
      { id: 'a', name: 'Budget', chamber: 'Assembly' },
      { id: 'b', name: 'Health', chamber: 'Assembly' },
      { id: 'c', name: 'Education', chamber: 'Assembly' },
    ];

    it('passes the env-default cap into the DB query as `take`', async () => {
      const built = await buildService({
        configValues: {
          LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES: '2',
        },
        dbRows: three.slice(0, 2),
      });
      built.llm.generate.mockResolvedValue({
        text: '{"description":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(built.db.legislativeCommittee.findMany.mock.calls[0][0].take).toBe(
        2,
      );
      expect(built.llm.generate).toHaveBeenCalledTimes(2);
    });

    it('mutation-arg override beats env default', async () => {
      const built = await buildService({
        configValues: {
          LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES: '5',
        },
        dbRows: three.slice(0, 1),
      });
      built.llm.generate.mockResolvedValue({
        text: '{"description":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions(1);

      expect(built.db.legislativeCommittee.findMany.mock.calls[0][0].take).toBe(
        1,
      );
    });

    it('omits `take` when no cap is configured', async () => {
      const built = await buildService({ dbRows: three });
      built.llm.generate.mockResolvedValue({
        text: '{"description":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(
        'take' in built.db.legislativeCommittee.findMany.mock.calls[0][0],
      ).toBe(false);
    });
  });

  describe('prompt formatting', () => {
    it('formats committee identity as Chamber + Committee Name and routes to the right prompt', async () => {
      const built = await buildService({
        dbRows: [{ id: 'c1', name: 'Health', chamber: 'Assembly' }],
      });
      built.llm.generate.mockResolvedValue({
        text: '{"description":"Considers public-health bills."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      const promptArg =
        built.promptClient.getDocumentAnalysisPrompt.mock.calls[0][0];
      expect(promptArg.documentType).toBe('legislative-committee-description');
      expect(promptArg.text).toContain('Chamber: Assembly');
      expect(promptArg.text).toContain('Committee Name: Health');
    });
  });

  describe('response parsing', () => {
    const base = { id: 'c1', name: 'Budget', chamber: 'Assembly' };

    it('tier-1: persists description from a clean JSON response', async () => {
      const built = await buildService({ dbRows: [base] });
      built.llm.generate.mockResolvedValue({
        text: '{"description":"Reviews the state budget."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(built.db.legislativeCommittee.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { description: 'Reviews the state budget.' },
      });
    });

    it('tier-1: explicit `null` description means "name too generic" and is not persisted', async () => {
      const built = await buildService({ dbRows: [base] });
      built.llm.generate.mockResolvedValue({
        text: '{"description":null}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(built.db.legislativeCommittee.update).not.toHaveBeenCalled();
    });

    it('tier-2: salvages description field from a truncated response', async () => {
      const built = await buildService({ dbRows: [base] });
      built.llm.generate.mockResolvedValue({
        text: '{"description":"Considers fiscal-impact legislation",',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(built.db.legislativeCommittee.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { description: 'Considers fiscal-impact legislation' },
      });
    });

    it('returns without update when both tiers fail', async () => {
      const built = await buildService({ dbRows: [base] });
      built.llm.generate.mockResolvedValue({
        text: 'no json at all',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(built.db.legislativeCommittee.update).not.toHaveBeenCalled();
    });

    it('swallows LLM errors so one failed committee does not cancel peers', async () => {
      const built = await buildService({
        dbRows: [
          { ...base, id: 'c1' },
          { ...base, id: 'c2', name: 'Survivor' },
        ],
      });
      built.llm.generate
        .mockRejectedValueOnce(new Error('flake'))
        .mockResolvedValueOnce({
          text: '{"description":"ok"}',
        } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingDescriptions();

      expect(built.db.legislativeCommittee.update).toHaveBeenCalledTimes(1);
      expect(built.db.legislativeCommittee.update).toHaveBeenCalledWith({
        where: { id: 'c2' },
        data: { description: 'ok' },
      });
    });
  });
});
