import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';

import { PersonalizedImpactService } from './personalized-impact.service';
import { PersonalizedImpactInput } from '../dto/personalized-impact.dto';

describe('PersonalizedImpactService', () => {
  let service: PersonalizedImpactService;
  let db: { document: { findFirst: jest.Mock } };
  let llm: {
    generate: jest.Mock;
    getName: jest.Mock;
    getModelName: jest.Mock;
  };
  let promptClient: jest.Mocked<PromptClientService>;

  const baseInput: PersonalizedImpactInput = {
    documentId: 'doc-1',
    interestTags: ['housing'],
    rankingFlags: ['isRenter'],
    regionLabel: '94xxx',
  };

  const docWithAnalysis = {
    id: 'doc-1',
    type: 'petition',
    analysis: {
      summary: 'Caps rent increases at 5%.',
      actualEffect: 'Limits annual rent hikes.',
      beneficiaries: ['renters'],
      potentiallyHarmed: ['landlords'],
    },
  };

  beforeEach(async () => {
    db = { document: { findFirst: jest.fn() } };
    llm = {
      generate: jest.fn(),
      getName: jest.fn().mockReturnValue('TestLLM'),
      getModelName: jest.fn().mockReturnValue('test-model'),
    };
    promptClient = createMock<PromptClientService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedImpactService,
        { provide: DbService, useValue: db },
        { provide: 'LLM_PROVIDER', useValue: llm },
        { provide: PromptClientService, useValue: promptClient },
      ],
    }).compile();

    service = module.get(PersonalizedImpactService);
  });

  it('returns null when the user has no declared signals (nothing to personalize)', async () => {
    const result = await service.generate('user-1', {
      ...baseInput,
      interestTags: [],
      rankingFlags: [],
    });
    expect(result).toBeNull();
    expect(db.document.findFirst).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('returns null when the document is missing or unanalyzed', async () => {
    db.document.findFirst.mockResolvedValueOnce(null);
    expect(await service.generate('user-1', baseInput)).toBeNull();

    db.document.findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      analysis: null,
    });
    expect(await service.generate('user-1', baseInput)).toBeNull();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('generates a personalized read from the analysis + declared signals', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'a'.repeat(64),
      promptVersion: 'v2',
    });
    llm.generate.mockResolvedValue({
      text: '  As a renter, this caps your rent.  ',
    });

    const result = await service.generate('user-1', baseInput);

    expect(result).toEqual({
      text: 'As a renter, this caps your rent.',
      provider: 'TestLLM',
      model: 'test-model',
      promptVersion: 'v2',
      fromCache: false,
    });
    // Only declared signals + analysis fields reach the prompt.
    expect(promptClient.getPersonalizedImpactPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'petition',
        summary: 'Caps rent increases at 5%.',
        beneficiaries: ['renters'],
        potentiallyHarmed: ['landlords'],
        userInterestTags: ['housing'],
        userRankingFlags: ['isRenter'],
        userRegionLabel: '94xxx',
      }),
    );
  });

  it('returns null when the LLM yields empty text', async () => {
    db.document.findFirst.mockResolvedValueOnce(docWithAnalysis);
    promptClient.getPersonalizedImpactPrompt.mockResolvedValue({
      promptText: 'PROMPT',
      promptHash: 'a'.repeat(64),
      promptVersion: 'v2',
    });
    llm.generate.mockResolvedValue({ text: '   ' });

    expect(await service.generate('user-1', baseInput)).toBeNull();
  });
});
