import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { KnowledgeResolver } from './knowledge.resolver';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeResolver', () => {
  let knowledgeResolver: KnowledgeResolver;
  let knowledgeService: KnowledgeService;

  const mockUser = { id: 'user-1', email: 'user@example.com' };

  const mockContext = {
    req: {
      user: mockUser,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeResolver,
        {
          provide: KnowledgeService,
          useValue: createMock<KnowledgeService>(),
        },
      ],
    }).compile();

    knowledgeResolver = module.get<KnowledgeResolver>(KnowledgeResolver);
    knowledgeService = module.get<KnowledgeService>(KnowledgeService);
  });

  it('resolver and services should be defined', () => {
    expect(knowledgeResolver).toBeDefined();
    expect(knowledgeService).toBeDefined();
  });

  describe('answerQuery', () => {
    it('should return answer from knowledge service for authenticated user', async () => {
      const mockAnswer = 'This is the answer to your question.';
      knowledgeService.answerQuery = jest.fn().mockResolvedValue(mockAnswer);

      const result = await knowledgeResolver.answerQuery(
        { query: 'What is the topic?' },
        mockContext,
      );

      expect(result).toBe(mockAnswer);
      expect(knowledgeService.answerQuery).toHaveBeenCalledWith(
        'user-1',
        'What is the topic?',
      );
    });

    it('should propagate errors from service', async () => {
      knowledgeService.answerQuery = jest
        .fn()
        .mockRejectedValue(new Error('Query failed'));

      await expect(
        knowledgeResolver.answerQuery({ query: 'test query' }, mockContext),
      ).rejects.toThrow('Query failed');
    });
  });

  describe('searchText', () => {
    it('should return paginated search results for authenticated user', async () => {
      const mockResults = {
        results: [
          { content: 'chunk 1', documentId: 'doc-1', score: 0.95 },
          { content: 'chunk 2', documentId: 'doc-1', score: 0.85 },
          { content: 'chunk 3', documentId: 'doc-2', score: 0.75 },
        ],
        total: 3,
        hasMore: false,
      };
      knowledgeService.searchText = jest.fn().mockResolvedValue(mockResults);

      const result = await knowledgeResolver.searchText(
        { query: 'search term', skip: 0, take: 10 },
        mockContext,
      );

      expect(result).toEqual(mockResults);
      expect(knowledgeService.searchText).toHaveBeenCalledWith(
        'user-1',
        'search term',
        0,
        10,
      );
    });

    it('should return empty results when no matches found', async () => {
      const emptyResults = {
        results: [],
        total: 0,
        hasMore: false,
      };
      knowledgeService.searchText = jest.fn().mockResolvedValue(emptyResults);

      const result = await knowledgeResolver.searchText(
        { query: 'unknown term', skip: 0, take: 10 },
        mockContext,
      );

      expect(result).toEqual(emptyResults);
    });

    it('should support pagination with skip and take', async () => {
      const mockResults = {
        results: [{ content: 'chunk 11', documentId: 'doc-3', score: 0.65 }],
        total: 11,
        hasMore: false,
      };
      knowledgeService.searchText = jest.fn().mockResolvedValue(mockResults);

      const result = await knowledgeResolver.searchText(
        { query: 'search term', skip: 10, take: 5 },
        mockContext,
      );

      expect(result).toEqual(mockResults);
      expect(knowledgeService.searchText).toHaveBeenCalledWith(
        'user-1',
        'search term',
        10,
        5,
      );
    });
  });

  describe('indexDocument', () => {
    it('should return true when indexing succeeds for authenticated user', async () => {
      knowledgeService.indexDocument = jest.fn().mockResolvedValue(undefined);

      const result = await knowledgeResolver.indexDocument(
        { documentId: 'doc-1', text: 'Document content' },
        mockContext,
      );

      expect(result).toBe(true);
      expect(knowledgeService.indexDocument).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
        'Document content',
      );
    });

    it('should throw UserInputError when indexing fails', async () => {
      knowledgeService.indexDocument = jest
        .fn()
        .mockRejectedValue(new Error('Index failed'));

      await expect(
        knowledgeResolver.indexDocument(
          { documentId: 'doc-1', text: 'Document content' },
          mockContext,
        ),
      ).rejects.toThrow('Failed to index document: Index failed');
    });
  });
});
