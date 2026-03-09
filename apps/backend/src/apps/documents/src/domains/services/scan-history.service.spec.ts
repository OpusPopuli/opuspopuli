import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { ScanHistoryService } from './scan-history.service';

describe('ScanHistoryService', () => {
  let service: ScanHistoryService;
  let db: {
    document: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    db = {
      document: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ScanHistoryService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get<ScanHistoryService>(ScanHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getScanHistory', () => {
    it('should return paginated scan history', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          type: 'petition',
          status: 'ai_analysis_complete',
          analysis: { summary: 'Test summary' },
          ocrConfidence: 95.5,
          createdAt: new Date('2024-01-01'),
        },
      ];
      db.document.findMany.mockResolvedValue(mockDocs);
      db.document.count.mockResolvedValue(1);

      const result = await service.getScanHistory('user-1', 0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('doc-1');
      expect(result.items[0].summary).toBe('Test summary');
      expect(result.items[0].hasAnalysis).toBe(true);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more items exist', async () => {
      db.document.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          type: 'petition',
          status: 'text_extraction_complete',
          analysis: null,
          ocrConfidence: null,
          createdAt: new Date(),
        },
      ]);
      db.document.count.mockResolvedValue(25);

      const result = await service.getScanHistory('user-1', 0, 10);

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(25);
    });

    it('should apply search filter', async () => {
      db.document.findMany.mockResolvedValue([]);
      db.document.count.mockResolvedValue(0);

      await service.getScanHistory('user-1', 0, 10, { search: 'parks' });

      expect(db.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            extractedText: { contains: 'parks', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should apply date range filters', async () => {
      db.document.findMany.mockResolvedValue([]);
      db.document.count.mockResolvedValue(0);

      await service.getScanHistory('user-1', 0, 10, {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });

      expect(db.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2024-01-01'),
              lte: new Date('2024-12-31'),
            },
          }),
        }),
      );
    });

    it('should handle documents with null analysis', async () => {
      db.document.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          type: 'petition',
          status: 'text_extraction_complete',
          analysis: null,
          ocrConfidence: null,
          createdAt: new Date(),
        },
      ]);
      db.document.count.mockResolvedValue(1);

      const result = await service.getScanHistory('user-1', 0, 10);

      expect(result.items[0].hasAnalysis).toBe(false);
      expect(result.items[0].summary).toBeUndefined();
      expect(result.items[0].ocrConfidence).toBeUndefined();
    });
  });

  describe('getScanDetail', () => {
    it('should return scan detail for owned document', async () => {
      const mockDoc = {
        id: 'doc-1',
        type: 'petition',
        status: 'ai_analysis_complete',
        extractedText: 'Some text',
        ocrConfidence: 95.5,
        ocrProvider: 'tesseract',
        analysis: { summary: 'Test' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      db.document.findFirst.mockResolvedValue(mockDoc);

      const result = await service.getScanDetail('user-1', 'doc-1');

      expect(result.id).toBe('doc-1');
      expect(result.extractedText).toBe('Some text');
      expect(result.ocrConfidence).toBe(95.5);
      expect(result.analysis).toEqual({ summary: 'Test' });
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.getScanDetail('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle document with null optional fields', async () => {
      db.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        type: 'petition',
        status: 'text_extraction_started',
        extractedText: null,
        ocrConfidence: null,
        ocrProvider: null,
        analysis: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getScanDetail('user-1', 'doc-1');

      expect(result.extractedText).toBeUndefined();
      expect(result.ocrConfidence).toBeUndefined();
      expect(result.ocrProvider).toBeUndefined();
      expect(result.analysis).toBeUndefined();
    });
  });

  describe('softDeleteDocument', () => {
    it('should soft-delete a document and return true', async () => {
      db.document.findFirst.mockResolvedValue({ id: 'doc-1' });
      db.document.update.mockResolvedValue({});

      const result = await service.softDeleteDocument('user-1', 'doc-1');

      expect(result).toBe(true);
      expect(db.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.softDeleteDocument('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAllUserScans', () => {
    it('should soft-delete all user documents and return count', async () => {
      db.document.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.deleteAllUserScans('user-1');

      expect(result).toBe(5);
      expect(db.document.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should return 0 when user has no documents', async () => {
      db.document.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.deleteAllUserScans('user-1');

      expect(result).toBe(0);
    });
  });
});
