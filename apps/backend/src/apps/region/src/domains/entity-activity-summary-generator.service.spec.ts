import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { EntityActivitySummaryGeneratorService } from './entity-activity-summary-generator.service';

interface RepRow {
  id: string;
  name: string;
  chamber: string;
  activitySummaryGeneratedAt: Date | null;
}

interface CommitteeRow {
  id: string;
  name: string;
  chamber: string;
}

interface ActionRow {
  date: Date;
  actionType: string;
  rawSubject: string | null;
  text: string | null;
}

describe('EntityActivitySummaryGeneratorService', () => {
  async function buildService(
    opts: {
      withDeps?: boolean;
      withDb?: boolean;
      reps?: RepRow[];
      committees?: CommitteeRow[];
      /** Action rows the mocked DB will return for the structured-input bundle. */
      actions?: ActionRow[];
      llmText?: string;
      configValues?: Record<string, string | undefined>;
    } = {},
  ) {
    const {
      withDeps = true,
      withDb = true,
      reps = [],
      committees = [],
      actions = [],
      llmText = '{"summary":"Generated activity summary."}',
      configValues = {},
    } = opts;

    const mockPromptClient = createMock<PromptClientService>();
    mockPromptClient.getDocumentAnalysisPrompt.mockResolvedValue({
      promptText: 'built prompt',
      promptHash: 'hash',
      promptVersion: '1.0.0',
    });

    const mockLlm = {
      generate: jest.fn().mockResolvedValue({ text: llmText, tokensUsed: 100 }),
    } as unknown as jest.Mocked<ILLMProvider>;

    const mockConfig = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    const repUpdate = jest.fn().mockResolvedValue(undefined);
    const cmtUpdate = jest.fn().mockResolvedValue(undefined);

    // Group counts by action_type so the service's groupBy works.
    const groupCounts: { actionType: string; _count: { _all: number } }[] = [];
    {
      const counts = new Map<string, number>();
      for (const a of actions)
        counts.set(a.actionType, (counts.get(a.actionType) ?? 0) + 1);
      for (const [k, v] of counts.entries()) {
        groupCounts.push({ actionType: k, _count: { _all: v } });
      }
    }

    const mockDb = {
      representative: {
        findMany: jest.fn().mockResolvedValue(reps),
        update: repUpdate,
      },
      legislativeCommittee: {
        findMany: jest.fn().mockResolvedValue(committees),
        update: cmtUpdate,
      },
      legislativeAction: {
        groupBy: jest.fn().mockResolvedValue(groupCounts),
        findMany: jest.fn().mockResolvedValue(actions),
      },
    } as unknown as DbService;

    const providers: unknown[] = [EntityActivitySummaryGeneratorService];
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
      service: module.get(EntityActivitySummaryGeneratorService),
      promptClient: mockPromptClient,
      llm: mockLlm,
      repUpdate,
      cmtUpdate,
    };
  }

  it('returns zero counts when promptClient is missing (graceful degrade)', async () => {
    const { service } = await buildService({ withDeps: false });
    const result = await service.generateAll();
    expect(result).toEqual({
      repsUpdated: 0,
      committeesUpdated: 0,
      skipped: 0,
    });
  });

  it('returns zero counts when DbService is missing', async () => {
    const { service } = await buildService({ withDb: false });
    const result = await service.generateAll();
    expect(result.repsUpdated).toBe(0);
    expect(result.committeesUpdated).toBe(0);
  });

  it('generates and persists summaries for reps with recent activity', async () => {
    const { service, repUpdate, promptClient } = await buildService({
      reps: [
        {
          id: 'rep-1',
          name: 'Bauer-Kahan, Rebecca',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
      ],
      actions: [
        {
          date: new Date('2026-04-28T00:00:00Z'),
          actionType: 'amendment',
          rawSubject: 'AB 1897',
          text: 'Amendment adopted in Health committee.',
        },
        {
          date: new Date('2026-04-27T00:00:00Z'),
          actionType: 'committee_hearing',
          rawSubject: 'Privacy and Consumer Protection',
          text: 'Hearing on April 27, 2026.',
        },
      ],
      llmText:
        '{"summary":"Bauer-Kahan attended hearings and authored amendments."}',
    });

    const result = await service.generateAll();

    expect(result.repsUpdated).toBe(1);
    expect(repUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rep-1' },
        data: expect.objectContaining({
          activitySummary:
            'Bauer-Kahan attended hearings and authored amendments.',
          activitySummaryWindowDays: 90,
        }),
      }),
    );
    // The prompt-service is called with the rep-specific documentType.
    expect(promptClient.getDocumentAnalysisPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'representative-activity-summary',
      }),
    );
  });

  it('generates summaries for committees with recent activity', async () => {
    const { service, cmtUpdate, promptClient } = await buildService({
      committees: [{ id: 'cmt-1', name: 'Public Safety', chamber: 'Assembly' }],
      actions: [
        {
          date: new Date('2026-04-28T00:00:00Z'),
          actionType: 'committee_report',
          rawSubject: 'AB 1897',
          text: 'Do pass.',
        },
      ],
      llmText: '{"summary":"Public Safety processed several bills this week."}',
    });

    const result = await service.generateAll();

    expect(result.committeesUpdated).toBe(1);
    expect(cmtUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cmt-1' },
        data: expect.objectContaining({
          activitySummary: 'Public Safety processed several bills this week.',
        }),
      }),
    );
    expect(promptClient.getDocumentAnalysisPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'committee-activity-summary',
      }),
    );
  });

  it('skips entities with no actions in the window', async () => {
    const { service, repUpdate } = await buildService({
      reps: [
        {
          id: 'rep-noactivity',
          name: 'Nobody, Active',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
      ],
      actions: [],
    });

    const result = await service.generateAll();

    expect(result.repsUpdated).toBe(0);
    expect(repUpdate).not.toHaveBeenCalled();
  });

  it('falls back to extractFieldString when JSON is malformed (tier-2 parse)', async () => {
    const { service, repUpdate } = await buildService({
      reps: [
        {
          id: 'rep-1',
          name: 'Schultz, Nick',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
      ],
      actions: [
        {
          date: new Date('2026-04-28T00:00:00Z'),
          actionType: 'committee_hearing',
          rawSubject: 'Public Safety',
          text: 'Hearing held.',
        },
      ],
      // Truncated JSON — closing brace missing. extractFieldString recovers
      // the summary value via field-slice.
      llmText: '{"summary": "Recovered from truncated output"',
    });

    const result = await service.generateAll();

    expect(result.repsUpdated).toBe(1);
    expect(repUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activitySummary: 'Recovered from truncated output',
        }),
      }),
    );
  });

  it('skips an entity when the LLM produces no parseable summary', async () => {
    const { service, repUpdate } = await buildService({
      reps: [
        {
          id: 'rep-1',
          name: 'Lackey, Tom',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
      ],
      actions: [
        {
          date: new Date('2026-04-28T00:00:00Z'),
          actionType: 'committee_hearing',
          rawSubject: 'Public Safety',
          text: 'Hearing held.',
        },
      ],
      llmText: 'completely non-JSON garbage with no summary field anywhere',
    });

    const result = await service.generateAll();

    expect(result.repsUpdated).toBe(0);
    expect(repUpdate).not.toHaveBeenCalled();
  });

  it('continues on per-entity errors', async () => {
    const { service, repUpdate } = await buildService({
      reps: [
        {
          id: 'rep-fail',
          name: 'Fail, First',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
        {
          id: 'rep-ok',
          name: 'OK, Second',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
      ],
      actions: [
        {
          date: new Date('2026-04-28T00:00:00Z'),
          actionType: 'amendment',
          rawSubject: 'AB 1',
          text: 'amend.',
        },
      ],
      llmText: '{"summary":"second rep summary"}',
    });

    // First update throws, second resolves.
    repUpdate
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValueOnce(undefined);

    const result = await service.generateAll();

    expect(result.repsUpdated).toBe(1);
    expect(repUpdate).toHaveBeenCalledTimes(2);
  });

  it('honors a caller-supplied window override', async () => {
    const { service } = await buildService({
      reps: [
        {
          id: 'rep-1',
          name: 'Test',
          chamber: 'Assembly',
          activitySummaryGeneratedAt: null,
        },
      ],
      actions: [
        {
          date: new Date(),
          actionType: 'amendment',
          rawSubject: 'AB 1',
          text: 't',
        },
      ],
    });

    const result = await service.generateAll(30);
    // Result returns the windowDays the service used.
    expect(result.repsUpdated).toBe(1);
  });
});
