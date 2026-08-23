import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';

import { MetricsService } from 'src/common/metrics';
import { AnalysisService } from './analysis.service';
import { LinkingService } from './linking.service';
import { parseAnalysisResponse } from '../prompts/document-analysis.prompt';

// Mock the parseAnalysisResponse function
jest.mock('../prompts/document-analysis.prompt', () => ({
  parseAnalysisResponse: jest.fn().mockReturnValue({
    summary: 'Test summary',
    keyPoints: ['Point 1'],
    entities: ['Entity 1'],
    relatedMeasures: ['Prop 47'],
    actualEffect: 'Some effect',
  }),
}));

describe('AnalysisService', () => {
  let service: AnalysisService;
  let db: {
    document: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let llm: {
    generate: jest.Mock;
    getName: jest.Mock;
    getModelName: jest.Mock;
  };
  let promptClient: jest.Mocked<PromptClientService>;
  let metricsService: jest.Mocked<MetricsService>;
  let linkingService: jest.Mocked<LinkingService>;

  beforeEach(async () => {
    db = {
      document: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    llm = {
      generate: jest.fn(),
      getName: jest.fn().mockReturnValue('TestLLM'),
      getModelName: jest.fn().mockReturnValue('test-model'),
    };

    promptClient = createMock<PromptClientService>();
    metricsService = createMock<MetricsService>();
    linkingService = createMock<LinkingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: DbService, useValue: db },
        { provide: 'LLM_PROVIDER', useValue: llm },
        { provide: PromptClientService, useValue: promptClient },
        { provide: MetricsService, useValue: metricsService },
        { provide: LinkingService, useValue: linkingService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeDocument', () => {
    const mockDocument = {
      id: 'doc-1',
      userId: 'user-1',
      // Long enough to clear the #1057 minimum-text pre-gate.
      extractedText:
        'We the undersigned registered voters respectfully petition the county ' +
        'board of supervisors to fund the restoration of Riverside Park.',
      contentHash: 'hash-123',
      type: 'petition',
    };

    it('should return cached analysis on cache hit', async () => {
      const cachedAnalysis = { summary: 'Cached summary' };
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument) // ownership check
        .mockResolvedValueOnce({ id: 'doc-2', analysis: cachedAnalysis }); // cache hit

      const result = await service.analyzeDocument('user-1', 'doc-1');

      expect(result.fromCache).toBe(true);
      expect(result.analysis).toEqual(
        expect.objectContaining({
          summary: 'Cached summary',
          cachedFrom: 'doc-2',
        }),
      );
      expect(metricsService.recordAnalysisCacheHit).toHaveBeenCalledWith(
        'documents-service',
      );
      expect(llm.generate).not.toHaveBeenCalled();
    });

    it('should perform fresh analysis on cache miss', async () => {
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument) // ownership check
        .mockResolvedValueOnce(null); // cache miss
      db.document.update.mockResolvedValue({});

      promptClient.getDocumentAnalysisPrompt.mockResolvedValue({
        promptText: 'Analyze this document...',
        promptHash: 'prompt-hash-1',
        promptVersion: 'v2',
      });

      llm.generate.mockResolvedValue({
        text: '{"summary":"Test summary"}',
        tokensUsed: 500,
      });

      const result = await service.analyzeDocument('user-1', 'doc-1');

      expect(result.fromCache).toBe(false);
      expect(result.analysis).toBeDefined();
      expect(llm.generate).toHaveBeenCalled();
      expect(metricsService.recordAnalysisCacheMiss).toHaveBeenCalledWith(
        'documents-service',
      );
      expect(metricsService.recordAnalysis).toHaveBeenCalledWith(
        'documents-service',
        'petition',
        'success',
        expect.any(Number),
      );
    });

    it('marks fresh petition analyses with an explicit isPetition: true', async () => {
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null);
      db.document.update.mockResolvedValue({});
      promptClient.getDocumentAnalysisPrompt.mockResolvedValue({
        promptText: 'Analyze...',
        promptHash: 'h1',
        promptVersion: 'v2',
      });
      llm.generate.mockResolvedValue({
        text: '{"summary":"A real petition"}',
        tokensUsed: 100,
      });

      const result = await service.analyzeDocument('user-1', 'doc-1');
      expect(result.analysis.isPetition).toBe(true);
    });

    it('maps the skip sentinel to a non-petition verdict — nothing fabricated, no linking (#1057)', async () => {
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null);
      db.document.update.mockResolvedValue({});
      promptClient.getDocumentAnalysisPrompt.mockResolvedValue({
        promptText: 'Analyze...',
        promptHash: 'h1',
        promptVersion: 'v2',
      });
      llm.generate.mockResolvedValue({
        text: '{"skip": true, "reason": "not_a_petition"}',
        tokensUsed: 40,
      });
      // parseAnalysisResponse is module-mocked to a full analysis; the
      // sentinel arrives through the parsed object, so override it here.
      (parseAnalysisResponse as jest.Mock).mockReturnValueOnce({
        skip: true,
        reason: 'not_a_petition',
      });

      const result = await service.analyzeDocument('user-1', 'doc-1');

      expect(result.fromCache).toBe(false);
      expect(result.analysis).toEqual(
        expect.objectContaining({
          isPetition: false,
          skipReason: 'not_a_petition',
          summary: '',
          keyPoints: [],
          entities: [],
          promptVersion: 'v2',
        }),
      );
      // The verdict is persisted (and thereby cached by contentHash+type).
      expect(db.document.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ai_analysis_complete',
            analysis: expect.objectContaining({ isPetition: false }),
          }),
        }),
      );
      expect(
        linkingService.matchAndLinkPropositionsSafely,
      ).not.toHaveBeenCalled();
      expect(metricsService.recordAnalysis).toHaveBeenCalledWith(
        'documents-service',
        'petition',
        'skipped_not_a_petition',
        expect.any(Number),
      );
    });

    it('coerces an out-of-vocabulary skip reason to not_a_petition', async () => {
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null);
      db.document.update.mockResolvedValue({});
      promptClient.getDocumentAnalysisPrompt.mockResolvedValue({
        promptText: 'Analyze...',
        promptHash: 'h1',
        promptVersion: 'v2',
      });
      // The reason enum is a privacy control — a model echoing document
      // text here must never reach the stored verdict.
      llm.generate.mockResolvedValue({
        text: '{"skip": true, "reason": "Chef specials: soup of the day"}',
      });
      (parseAnalysisResponse as jest.Mock).mockReturnValueOnce({
        skip: true,
        reason: 'Chef specials: soup of the day',
      });

      const result = await service.analyzeDocument('user-1', 'doc-1');
      expect(result.analysis.skipReason).toBe('not_a_petition');
    });

    it('pre-gates near-empty petition text without paying for an LLM call (#1057)', async () => {
      db.document.findFirst
        .mockResolvedValueOnce({ ...mockDocument, extractedText: 'menu $5' })
        .mockResolvedValueOnce(null);
      db.document.update.mockResolvedValue({});

      const result = await service.analyzeDocument('user-1', 'doc-1');

      expect(result.analysis).toEqual(
        expect.objectContaining({
          isPetition: false,
          skipReason: 'unreadable',
          provider: 'documents-service',
          model: 'min-text-gate',
        }),
      );
      expect(promptClient.getDocumentAnalysisPrompt).not.toHaveBeenCalled();
      expect(llm.generate).not.toHaveBeenCalled();
      expect(metricsService.recordAnalysis).toHaveBeenCalledWith(
        'documents-service',
        'petition',
        'skipped_unreadable',
        expect.any(Number),
      );
    });

    it('does not pre-gate short text for non-petition document types', async () => {
      db.document.findFirst
        .mockResolvedValueOnce({
          ...mockDocument,
          type: 'contract',
          extractedText: 'Short contract.',
        })
        .mockResolvedValueOnce(null);
      db.document.update.mockResolvedValue({});
      promptClient.getDocumentAnalysisPrompt.mockResolvedValue({
        promptText: 'Analyze...',
        promptHash: 'h1',
        promptVersion: 'v1',
      });
      llm.generate.mockResolvedValue({ text: '{"summary":"A contract"}' });

      const result = await service.analyzeDocument('user-1', 'doc-1');
      expect(llm.generate).toHaveBeenCalled();
      expect(result.analysis.isPetition).toBeUndefined();
    });

    it('should auto-link propositions for petition documents', async () => {
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null); // cache miss
      db.document.update.mockResolvedValue({});

      promptClient.getDocumentAnalysisPrompt.mockResolvedValue({
        promptText: 'Analyze...',
        promptHash: 'hash',
        promptVersion: 'v1',
      });
      llm.generate.mockResolvedValue({
        text: '{}',
        tokensUsed: 100,
      });

      await service.analyzeDocument('user-1', 'doc-1');

      expect(
        linkingService.matchAndLinkPropositionsSafely,
      ).toHaveBeenCalledWith('doc-1', ['Prop 47']);
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.analyzeDocument('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when text not extracted', async () => {
      db.document.findFirst.mockResolvedValue({
        ...mockDocument,
        extractedText: null,
      });

      await expect(service.analyzeDocument('user-1', 'doc-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update status to failed on error', async () => {
      db.document.findFirst
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null); // cache miss
      db.document.update.mockResolvedValue({});

      promptClient.getDocumentAnalysisPrompt.mockRejectedValue(
        new Error('Prompt service down'),
      );

      await expect(service.analyzeDocument('user-1', 'doc-1')).rejects.toThrow(
        'Prompt service down',
      );

      expect(db.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'ai_analysis_failed' },
      });
      expect(metricsService.recordAnalysis).toHaveBeenCalledWith(
        'documents-service',
        'petition',
        'failure',
        expect.any(Number),
      );
    });
  });

  describe('getDocumentAnalysis', () => {
    it('should return existing analysis', async () => {
      const mockAnalysis = { summary: 'Test', keyPoints: [] };
      db.document.findFirst.mockResolvedValue({ analysis: mockAnalysis });

      const result = await service.getDocumentAnalysis('user-1', 'doc-1');

      expect(result).toEqual(mockAnalysis);
      expect(db.document.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1', userId: 'user-1' },
        select: { analysis: true },
      });
    });

    it('should return null when no analysis exists', async () => {
      db.document.findFirst.mockResolvedValue({ analysis: null });

      const result = await service.getDocumentAnalysis('user-1', 'doc-1');

      expect(result).toBeNull();
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.getDocumentAnalysis('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
