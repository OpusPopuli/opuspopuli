import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';

describe('CommitteeSummaryGeneratorService', () => {
  async function buildService(
    opts: {
      withDeps?: boolean;
      withDb?: boolean;
      configValues?: Record<string, string | undefined>;
      dbRows?: Array<{
        id: string;
        name: string;
        chamber: string;
        committees: unknown;
      }>;
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
      representative: {
        findMany: jest.fn().mockResolvedValue(dbRows),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as DbService;

    const providers: unknown[] = [CommitteeSummaryGeneratorService];
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
      service: module.get(CommitteeSummaryGeneratorService),
      promptClient: mockPromptClient,
      llm: mockLlm,
      db: mockDb as DbService & {
        representative: {
          findMany: jest.Mock;
          update: jest.Mock;
        };
      },
    };
  }

  describe('when dependencies are unavailable', () => {
    it('returns silently with no db, prompt client, or llm', async () => {
      const built = await buildService({
        withDeps: false,
        withDb: false,
      });
      await expect(
        built.service.generateMissingSummaries(),
      ).resolves.toBeUndefined();
    });

    it('returns silently when db is available but prompt client + llm are not', async () => {
      const built = await buildService({ withDeps: false });
      await built.service.generateMissingSummaries();
      expect(built.db.representative.findMany).not.toHaveBeenCalled();
    });
  });

  describe('candidate selection', () => {
    it('queries for reps with committees but no summary and skips those with empty committees', async () => {
      const built = await buildService({
        dbRows: [
          {
            id: 'rep-empty',
            name: 'No Committees',
            chamber: 'Senate',
            committees: [],
          },
          {
            id: 'rep-null',
            name: 'Null Committees',
            chamber: 'Senate',
            committees: null,
          },
          {
            id: 'rep-with',
            name: 'Has Committees',
            chamber: 'Assembly',
            committees: [{ name: 'Budget', role: 'Chair' }],
          },
        ],
      });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"Budget chair."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      // Only the rep with non-empty committees should be generated + updated
      expect(built.llm.generate).toHaveBeenCalledTimes(1);
      expect(built.db.representative.update).toHaveBeenCalledTimes(1);
      expect(built.db.representative.update).toHaveBeenCalledWith({
        where: { id: 'rep-with' },
        data: { committeesSummary: 'Budget chair.' },
      });
    });

    it('filters DB candidates to those missing a summary', async () => {
      const built = await buildService();
      await built.service.generateMissingSummaries();
      const findManyArgs = built.db.representative.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toMatchObject({
        deletedAt: null,
        committeesSummary: null,
      });
    });

    it('returns early when no candidates have committees', async () => {
      const built = await buildService({
        dbRows: [
          {
            id: 'a',
            name: 'A',
            chamber: 'Senate',
            committees: [],
          },
        ],
      });
      await built.service.generateMissingSummaries();
      expect(built.llm.generate).not.toHaveBeenCalled();
      expect(built.db.representative.update).not.toHaveBeenCalled();
    });
  });

  describe('cap handling', () => {
    const threeWithCommittees = [
      {
        id: 'a',
        name: 'A',
        chamber: 'Assembly',
        committees: [{ name: 'Budget' }],
      },
      {
        id: 'b',
        name: 'B',
        chamber: 'Assembly',
        committees: [{ name: 'Health' }],
      },
      {
        id: 'c',
        name: 'C',
        chamber: 'Assembly',
        committees: [{ name: 'Education' }],
      },
    ];

    it('respects the env-default cap when set', async () => {
      const built = await buildService({
        configValues: { COMMITTEE_SUMMARY_GENERATOR_MAX_REPS: '2' },
        dbRows: threeWithCommittees,
      });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.llm.generate).toHaveBeenCalledTimes(2);
    });

    it('mutation-arg override takes precedence over env default', async () => {
      const built = await buildService({
        configValues: { COMMITTEE_SUMMARY_GENERATOR_MAX_REPS: '5' },
        dbRows: threeWithCommittees,
      });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries(1);

      expect(built.llm.generate).toHaveBeenCalledTimes(1);
    });

    it('ignores non-positive overrides and falls back to env default', async () => {
      const built = await buildService({
        configValues: { COMMITTEE_SUMMARY_GENERATOR_MAX_REPS: '2' },
        dbRows: threeWithCommittees,
      });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries(0);

      expect(built.llm.generate).toHaveBeenCalledTimes(2);
    });

    it('processes all candidates when no cap is configured', async () => {
      const built = await buildService({
        dbRows: threeWithCommittees,
      });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"ok"}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.llm.generate).toHaveBeenCalledTimes(3);
    });
  });

  describe('prompt formatting', () => {
    it('formats committees with role prefix and sends to the prompt service', async () => {
      const built = await buildService({
        dbRows: [
          {
            id: 'rep-1',
            name: 'Dawn Addis',
            chamber: 'Assembly',
            committees: [
              { name: 'Select Committee on X', role: 'Chair' },
              { name: 'Budget' },
            ],
          },
        ],
      });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"Ok."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      const promptArg =
        built.promptClient.getDocumentAnalysisPrompt.mock.calls[0][0];
      expect(promptArg.documentType).toBe('representative-committees-summary');
      expect(promptArg.text).toContain('Name: Dawn Addis');
      expect(promptArg.text).toContain('Chamber: Assembly');
      expect(promptArg.text).toContain('Chair: Select Committee on X');
      expect(promptArg.text).toContain('- Budget');
    });
  });

  describe('response parsing', () => {
    const baseRep = {
      id: 'rep-1',
      name: 'Jane',
      chamber: 'Senate',
      committees: [{ name: 'Budget' }],
    };

    it('tier-1: persists summary from a clean JSON response', async () => {
      const built = await buildService({ dbRows: [baseRep] });
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"Jane chairs Budget."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.db.representative.update).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
        data: { committeesSummary: 'Jane chairs Budget.' },
      });
    });

    it('tier-1: handles surrounding prose and code fences', async () => {
      const built = await buildService({ dbRows: [baseRep] });
      built.llm.generate.mockResolvedValue({
        text: 'Here is the output:\n```json\n{"summary":"Fenced."}\n```\nDone.',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.db.representative.update).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
        data: { committeesSummary: 'Fenced.' },
      });
    });

    it('tier-2: salvages the summary field from a truncated/malformed response', async () => {
      const built = await buildService({ dbRows: [baseRep] });
      // Closing brace missing, field complete
      built.llm.generate.mockResolvedValue({
        text: '{"summary":"Budget chair, fiscal oversight lead.",',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.db.representative.update).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
        data: { committeesSummary: 'Budget chair, fiscal oversight lead.' },
      });
    });

    it('returns without update when both tiers fail', async () => {
      const built = await buildService({ dbRows: [baseRep] });
      built.llm.generate.mockResolvedValue({
        text: 'no json here at all',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.db.representative.update).not.toHaveBeenCalled();
    });

    it('swallows LLM errors so one failed rep does not cancel peers', async () => {
      const built = await buildService({
        dbRows: [
          { ...baseRep, id: 'rep-1' },
          { ...baseRep, id: 'rep-2', name: 'Survivor' },
        ],
      });
      built.llm.generate
        .mockRejectedValueOnce(new Error('flake'))
        .mockResolvedValueOnce({
          text: '{"summary":"ok"}',
        } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await built.service.generateMissingSummaries();

      expect(built.db.representative.update).toHaveBeenCalledTimes(1);
      expect(built.db.representative.update).toHaveBeenCalledWith({
        where: { id: 'rep-2' },
        data: { committeesSummary: 'ok' },
      });
    });
  });
});
