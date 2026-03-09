import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { IStorageProvider } from '@opuspopuli/storage-provider';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { OcrService } from '@opuspopuli/ocr-provider';
import { ExtractionProvider } from '@opuspopuli/extraction-provider';

import { MetricsService } from 'src/common/metrics';
import { ScanService } from './scan.service';
import { FileService } from './file.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('ScanService', () => {
  let service: ScanService;
  let db: {
    document: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let storage: jest.Mocked<IStorageProvider>;
  let ocrService: jest.Mocked<OcrService>;
  let extractionProvider: jest.Mocked<ExtractionProvider>;
  let metricsService: jest.Mocked<MetricsService>;
  let fileService: jest.Mocked<FileService>;

  beforeEach(async () => {
    db = {
      document: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    storage = createMock<IStorageProvider>();
    ocrService = createMock<OcrService>();
    extractionProvider = createMock<ExtractionProvider>();
    metricsService = createMock<MetricsService>();
    fileService = createMock<FileService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanService,
        { provide: DbService, useValue: db },
        { provide: 'STORAGE_PROVIDER', useValue: storage },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({ bucket: 'test-bucket' }),
          },
        },
        { provide: OcrService, useValue: ocrService },
        { provide: ExtractionProvider, useValue: extractionProvider },
        { provide: MetricsService, useValue: metricsService },
        { provide: FileService, useValue: fileService },
      ],
    }).compile();

    service = module.get<ScanService>(ScanService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processScan', () => {
    const base64Data = Buffer.from('test image data').toString('base64');

    it('should process a scan successfully', async () => {
      const mockDoc = { id: 'doc-1' };
      db.document.create.mockResolvedValue(mockDoc);
      db.document.update.mockResolvedValue({});
      storage.getSignedUrl.mockResolvedValue('https://upload-url');
      mockFetch.mockResolvedValue({ ok: true });
      ocrService.extractFromBuffer.mockResolvedValue({
        text: 'Extracted text',
        confidence: 95.0,
        provider: 'tesseract',
        blocks: [],
        processingTimeMs: 100,
      });

      const result = await service.processScan(
        'user-1',
        base64Data,
        'image/png',
      );

      expect(result.documentId).toBe('doc-1');
      expect(result.text).toBe('Extracted text');
      expect(result.confidence).toBe(95.0);
      expect(result.provider).toBe('tesseract');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(db.document.create).toHaveBeenCalled();
      expect(metricsService.recordScanProcessed).toHaveBeenCalledWith(
        'documents-service',
        'petition',
        'success',
        expect.any(Number),
      );
    });

    it('should update status to failed on error', async () => {
      const mockDoc = { id: 'doc-1' };
      db.document.create.mockResolvedValue(mockDoc);
      storage.getSignedUrl.mockRejectedValue(new Error('Upload failed'));

      await expect(
        service.processScan('user-1', base64Data, 'image/png'),
      ).rejects.toThrow('Upload failed');

      expect(db.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'text_extraction_failed' },
      });
      expect(metricsService.recordScanProcessed).toHaveBeenCalledWith(
        'documents-service',
        'petition',
        'failure',
        expect.any(Number),
      );
    });
  });

  describe('extractTextFromFile', () => {
    it('should extract text from an existing file', async () => {
      const mockDoc = { id: 'doc-1', userId: 'user-1', key: 'scan.png' };
      db.document.findFirst.mockResolvedValue(mockDoc);
      db.document.update.mockResolvedValue({});
      fileService.getDownloadUrl.mockResolvedValue('https://download-url');

      const imageBuffer = Buffer.from('fake image');
      mockFetch.mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(imageBuffer.buffer),
      });
      ocrService.extractFromBuffer.mockResolvedValue({
        text: 'OCR text',
        confidence: 90.0,
        provider: 'tesseract',
        blocks: [],
        processingTimeMs: 80,
      });

      const result = await service.extractTextFromFile('user-1', 'scan.png');

      expect(result.text).toBe('OCR text');
      expect(result.confidence).toBe(90.0);
      expect(result.provider).toBe('tesseract');
      expect(db.document.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.extractTextFromFile('user-1', 'missing.pdf'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('extractTextFromBase64', () => {
    it('should extract text from base64 image data', async () => {
      const base64Data = Buffer.from('test image').toString('base64');
      ocrService.extractFromBuffer.mockResolvedValue({
        text: 'Base64 OCR text',
        confidence: 88.0,
        provider: 'tesseract',
        blocks: [],
        processingTimeMs: 90,
      });

      const result = await service.extractTextFromBase64(
        'user-1',
        base64Data,
        'image/png',
      );

      expect(result.text).toBe('Base64 OCR text');
      expect(result.confidence).toBe(88.0);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should extract text from base64 PDF data', async () => {
      const base64Data = Buffer.from('fake pdf').toString('base64');
      extractionProvider.extractPdfText.mockResolvedValue('PDF text content');

      const result = await service.extractTextFromBase64(
        'user-1',
        base64Data,
        'application/pdf',
      );

      expect(result.text).toBe('PDF text content');
      expect(result.confidence).toBe(100);
      expect(result.provider).toBe('pdf-parse');
    });

    it('should extract text from base64 plain text data', async () => {
      const textContent = 'Plain text content';
      const base64Data = Buffer.from(textContent).toString('base64');

      const result = await service.extractTextFromBase64(
        'user-1',
        base64Data,
        'text/plain',
      );

      expect(result.text).toBe(textContent);
      expect(result.confidence).toBe(100);
      expect(result.provider).toBe('direct');
    });
  });
});
