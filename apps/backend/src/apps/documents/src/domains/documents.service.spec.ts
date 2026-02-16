/* eslint-disable @typescript-eslint/no-explicit-any */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DocumentsService } from './documents.service';
import { DbService, DocumentType } from '@opuspopuli/relationaldb-provider';
import { createMockDbService } from '@opuspopuli/relationaldb-provider/testing';
import { IStorageProvider } from '@opuspopuli/storage-provider';
import { OcrService } from '@opuspopuli/ocr-provider';
import { ExtractionProvider } from '@opuspopuli/extraction-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { DocumentStatus } from 'src/common/enums/document.status.enum';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('DocumentsService', () => {
  let documentsService: DocumentsService;
  let mockDb: ReturnType<typeof createMockDbService>;
  let storage: IStorageProvider;
  let ocrService: jest.Mocked<OcrService>;
  let extractionProvider: jest.Mocked<ExtractionProvider>;

  const mockFileConfig = {
    bucket: 'test-bucket',
    region: 'us-west-2',
  };

  // Using 'any' type for mock objects to avoid strict type checking
  const mockDocuments: any[] = [
    {
      id: 'doc-1',
      userId: 'user-1',
      key: 'file1.pdf',
      size: 1024,
      status: DocumentStatus.AIEMBEDDINGSCOMPLETE,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'doc-2',
      userId: 'user-1',
      key: 'file2.txt',
      size: 512,
      status: DocumentStatus.PROCESSINGNPENDING,
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
    },
  ];

  const mockStorageProvider = {
    getSignedUrl: jest.fn(),
    deleteFile: jest.fn(),
    uploadFile: jest.fn(),
  };

  const mockOcrService = {
    extractText: jest.fn(),
    extractFromBase64: jest.fn(),
    extractFromBuffer: jest.fn(),
    supportsMimeType: jest.fn(),
    getProviderInfo: jest.fn(),
  };

  const mockExtractionProvider = {
    extractPdfText: jest.fn(),
    extractFromUrl: jest.fn(),
  };

  const mockLLMProvider = {
    generate: jest.fn(),
    chat: jest.fn(),
    generateStream: jest.fn(),
    getName: jest.fn().mockReturnValue('Ollama'),
    getModelName: jest.fn().mockReturnValue('llama3.2'),
  };

  const mockPromptClient = {
    getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
      promptText: 'mock analysis prompt',
      promptHash: 'mock-hash',
      promptVersion: 'v1',
    }),
  };

  beforeEach(async () => {
    mockDb = createMockDbService();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DbService, useValue: mockDb },
        {
          provide: 'STORAGE_PROVIDER',
          useValue: mockStorageProvider,
        },
        {
          provide: 'LLM_PROVIDER',
          useValue: mockLLMProvider,
        },
        {
          provide: OcrService,
          useValue: mockOcrService,
        },
        {
          provide: ExtractionProvider,
          useValue: mockExtractionProvider,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(mockFileConfig),
          },
        },
        {
          provide: PromptClientService,
          useValue: mockPromptClient,
        },
      ],
    }).compile();

    documentsService = module.get<DocumentsService>(DocumentsService);
    storage = module.get<IStorageProvider>('STORAGE_PROVIDER');
    ocrService = module.get(OcrService);
    extractionProvider = module.get(ExtractionProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('services should be defined', () => {
    expect(documentsService).toBeDefined();
    expect(storage).toBeDefined();
    expect(ocrService).toBeDefined();
    expect(extractionProvider).toBeDefined();
  });

  describe('listFiles', () => {
    it('should return list of files for a user', async () => {
      mockDb.document.findMany.mockResolvedValue(mockDocuments);

      const files = await documentsService.listFiles('user-1');

      expect(files).toHaveLength(2);
      expect(files[0].filename).toBe('file1.pdf');
      expect(files[0].userId).toBe('user-1');
      expect(mockDb.document.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should return empty array when no documents found', async () => {
      mockDb.document.findMany.mockResolvedValue([]);

      const files = await documentsService.listFiles('user-1');

      expect(files).toEqual([]);
    });
  });

  describe('getUploadUrl', () => {
    it('should return signed upload URL', async () => {
      const mockUrl = 'https://s3.example.com/upload-url';
      mockStorageProvider.getSignedUrl.mockResolvedValue(mockUrl);

      const url = await documentsService.getUploadUrl('user-1', 'test.pdf');

      expect(url).toBe(mockUrl);
      expect(mockStorageProvider.getSignedUrl).toHaveBeenCalledWith(
        'test-bucket',
        'user-1/test.pdf',
        true,
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should return signed download URL', async () => {
      const mockUrl = 'https://s3.example.com/download-url';
      mockStorageProvider.getSignedUrl.mockResolvedValue(mockUrl);

      const url = await documentsService.getDownloadUrl('user-1', 'test.pdf');

      expect(url).toBe(mockUrl);
      expect(mockStorageProvider.getSignedUrl).toHaveBeenCalledWith(
        'test-bucket',
        'user-1/test.pdf',
        false,
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file and metadata successfully', async () => {
      mockStorageProvider.deleteFile.mockResolvedValue(true);
      mockDb.document.deleteMany.mockResolvedValue({ count: 1 });

      const result = await documentsService.deleteFile('user-1', 'test.pdf');

      expect(result).toBe(true);
      expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
        'test-bucket',
        'user-1/test.pdf',
      );
      expect(mockDb.document.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', key: 'test.pdf' },
      });
    });

    it('should return false when S3 deletion fails', async () => {
      mockStorageProvider.deleteFile.mockResolvedValue(false);

      const result = await documentsService.deleteFile('user-1', 'test.pdf');

      expect(result).toBe(false);
      expect(mockDb.document.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw error on storage error', async () => {
      mockStorageProvider.deleteFile.mockRejectedValue(
        new Error('Storage error'),
      );

      await expect(
        documentsService.deleteFile('user-1', 'test.pdf'),
      ).rejects.toThrow('Storage error');
    });
  });

  describe('getDocumentById', () => {
    it('should return document by ID', async () => {
      mockDb.document.findUnique.mockResolvedValue(mockDocuments[0]);

      const doc = await documentsService.getDocumentById('doc-1');

      expect(doc).toEqual(mockDocuments[0]);
      expect(mockDb.document.findUnique).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
    });

    it('should return null when document not found', async () => {
      mockDb.document.findUnique.mockResolvedValue(null);

      const doc = await documentsService.getDocumentById('unknown');

      expect(doc).toBeNull();
    });
  });

  describe('createDocument', () => {
    it('should create document metadata', async () => {
      const newDoc: any = {
        id: 'new-doc',
        location: 's3://bucket/path',
        userId: 'user-1',
        key: 'new-file.pdf',
        size: 2048,
        checksum: 'abc123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.document.create.mockResolvedValue(newDoc);

      const result = await documentsService.createDocument(
        's3://bucket/path',
        'user-1',
        'new-file.pdf',
        2048,
        'abc123',
      );

      expect(result).toEqual(newDoc);
      expect(mockDb.document.create).toHaveBeenCalledWith({
        data: {
          location: 's3://bucket/path',
          userId: 'user-1',
          key: 'new-file.pdf',
          size: 2048,
          checksum: 'abc123',
        },
      });
    });
  });

  describe('updateDocument', () => {
    it('should update document metadata', async () => {
      mockDb.document.update.mockResolvedValue(mockDocuments[0]);

      await documentsService.updateDocument('doc-1', {
        status: DocumentStatus.AIEMBEDDINGSCOMPLETE as any,
      });

      expect(mockDb.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: DocumentStatus.AIEMBEDDINGSCOMPLETE },
      });
    });
  });

  describe('extractTextFromFile', () => {
    const mockDocument = {
      id: 'doc-1',
      userId: 'user-1',
      key: 'test-image.png',
      size: 1024,
    };

    beforeEach(() => {
      mockStorageProvider.getSignedUrl.mockResolvedValue(
        'https://s3.example.com/download-url',
      );
    });

    it('should extract text from image file using OCR', async () => {
      mockDb.document.findFirst.mockResolvedValue(mockDocument as any);
      mockDb.document.update.mockResolvedValue(mockDocument as any);

      const imageBuffer = Buffer.from('fake-image-data');
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(imageBuffer),
      });

      mockOcrService.extractFromBuffer.mockResolvedValue({
        text: 'Extracted OCR text',
        confidence: 95.5,
        provider: 'Tesseract',
        blocks: [],
        processingTimeMs: 150,
      });

      const result = await documentsService.extractTextFromFile(
        'user-1',
        'test-image.png',
      );

      expect(result.text).toBe('Extracted OCR text');
      expect(result.confidence).toBe(95.5);
      expect(result.provider).toBe('Tesseract');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);

      expect(mockOcrService.extractFromBuffer).toHaveBeenCalledWith(
        imageBuffer,
        'image/png',
      );

      expect(mockDb.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          extractedText: 'Extracted OCR text',
          contentHash: expect.any(String),
          ocrConfidence: 95.5,
          ocrProvider: 'Tesseract',
        },
      });
    });

    it('should extract text from PDF file using extraction provider', async () => {
      const pdfDocument = { ...mockDocument, key: 'test-doc.pdf' } as any;
      mockDb.document.findFirst.mockResolvedValue(pdfDocument);
      mockDb.document.update.mockResolvedValue(pdfDocument);

      const pdfBuffer = Buffer.from('fake-pdf-data');
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(pdfBuffer),
      });

      mockExtractionProvider.extractPdfText.mockResolvedValue(
        'Extracted PDF text content',
      );

      const result = await documentsService.extractTextFromFile(
        'user-1',
        'test-doc.pdf',
      );

      expect(result.text).toBe('Extracted PDF text content');
      expect(result.confidence).toBe(100);
      expect(result.provider).toBe('pdf-parse');

      expect(mockExtractionProvider.extractPdfText).toHaveBeenCalledWith(
        pdfBuffer,
      );
      expect(mockOcrService.extractFromBuffer).not.toHaveBeenCalled();
    });

    it('should extract text from text file directly', async () => {
      const txtDocument = { ...mockDocument, key: 'readme.txt' } as any;
      mockDb.document.findFirst.mockResolvedValue(txtDocument);
      mockDb.document.update.mockResolvedValue(txtDocument);

      const textContent = 'This is plain text content';
      const textBuffer = Buffer.from(textContent, 'utf-8');
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(textBuffer),
      });

      const result = await documentsService.extractTextFromFile(
        'user-1',
        'readme.txt',
      );

      expect(result.text).toBe(textContent);
      expect(result.confidence).toBe(100);
      expect(result.provider).toBe('direct');

      expect(mockOcrService.extractFromBuffer).not.toHaveBeenCalled();
      expect(mockExtractionProvider.extractPdfText).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDb.document.findFirst.mockResolvedValue(null);

      await expect(
        documentsService.extractTextFromFile('user-1', 'missing.png'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle JPEG files correctly', async () => {
      const jpegDocument = { ...mockDocument, key: 'photo.jpg' } as any;
      mockDb.document.findFirst.mockResolvedValue(jpegDocument);
      mockDb.document.update.mockResolvedValue(jpegDocument);

      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from('jpeg-data')),
      });

      mockOcrService.extractFromBuffer.mockResolvedValue({
        text: 'JPEG text',
        confidence: 90,
        provider: 'Tesseract',
        blocks: [],
        processingTimeMs: 100,
      });

      const result = await documentsService.extractTextFromFile(
        'user-1',
        'photo.jpg',
      );

      expect(mockOcrService.extractFromBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(result.provider).toBe('Tesseract');
    });

    it('should handle markdown files as text', async () => {
      const mdDocument = { ...mockDocument, key: 'README.md' } as any;
      mockDb.document.findFirst.mockResolvedValue(mdDocument);
      mockDb.document.update.mockResolvedValue(mdDocument);

      const mdContent = '# Heading\n\nSome content';
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from(mdContent)),
      });

      const result = await documentsService.extractTextFromFile(
        'user-1',
        'README.md',
      );

      expect(result.text).toBe(mdContent);
      expect(result.provider).toBe('direct');
    });
  });

  describe('extractTextFromBase64', () => {
    it('should extract text from base64 image', async () => {
      const imageData = Buffer.from('fake-image').toString('base64');

      mockOcrService.extractFromBuffer.mockResolvedValue({
        text: 'Base64 OCR result',
        confidence: 92,
        provider: 'Tesseract',
        blocks: [],
        processingTimeMs: 120,
      });

      const result = await documentsService.extractTextFromBase64(
        'user-1',
        imageData,
        'image/png',
      );

      expect(result.text).toBe('Base64 OCR result');
      expect(result.confidence).toBe(92);
      expect(result.provider).toBe('Tesseract');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should extract text from base64 PDF', async () => {
      const pdfData = Buffer.from('fake-pdf').toString('base64');

      mockExtractionProvider.extractPdfText.mockResolvedValue('PDF content');

      const result = await documentsService.extractTextFromBase64(
        'user-1',
        pdfData,
        'application/pdf',
      );

      expect(result.text).toBe('PDF content');
      expect(result.confidence).toBe(100);
      expect(result.provider).toBe('pdf-parse');
    });

    it('should extract text from base64 text content', async () => {
      const textContent = 'Plain text content';
      const textData = Buffer.from(textContent).toString('base64');

      const result = await documentsService.extractTextFromBase64(
        'user-1',
        textData,
        'text/plain',
      );

      expect(result.text).toBe(textContent);
      expect(result.confidence).toBe(100);
      expect(result.provider).toBe('direct');
    });

    it('should throw BadRequestException for unsupported MIME type', async () => {
      const data = Buffer.from('some-data').toString('base64');

      await expect(
        documentsService.extractTextFromBase64('user-1', data, 'video/mp4'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('MIME type detection', () => {
    beforeEach(() => {
      mockDb.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
        key: 'test.png',
      } as any);
      mockDb.document.update.mockResolvedValue({} as any);
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from('data')),
      });
      mockOcrService.extractFromBuffer.mockResolvedValue({
        text: 'text',
        confidence: 90,
        provider: 'Tesseract',
        blocks: [],
        processingTimeMs: 100,
      });
      mockExtractionProvider.extractPdfText.mockResolvedValue('pdf text');
    });

    const testCases = [
      { ext: 'png', expectedMime: 'image/png', useOcr: true },
      { ext: 'jpg', expectedMime: 'image/jpeg', useOcr: true },
      { ext: 'jpeg', expectedMime: 'image/jpeg', useOcr: true },
      { ext: 'webp', expectedMime: 'image/webp', useOcr: true },
      { ext: 'bmp', expectedMime: 'image/bmp', useOcr: true },
      { ext: 'gif', expectedMime: 'image/gif', useOcr: true },
      { ext: 'tiff', expectedMime: 'image/tiff', useOcr: true },
      { ext: 'pdf', expectedMime: 'application/pdf', usePdf: true },
      { ext: 'txt', expectedMime: 'text/plain', useDirect: true },
      { ext: 'md', expectedMime: 'text/markdown', useDirect: true },
      { ext: 'csv', expectedMime: 'text/csv', useDirect: true },
    ];

    testCases.forEach(({ ext, expectedMime, useOcr, usePdf, useDirect }) => {
      it(`should detect .${ext} as ${expectedMime}`, async () => {
        mockDb.document.findFirst.mockResolvedValue({
          id: 'doc-1',
          userId: 'user-1',
          key: `test.${ext}`,
        } as any);

        await documentsService.extractTextFromFile('user-1', `test.${ext}`);

        if (useOcr) {
          expect(mockOcrService.extractFromBuffer).toHaveBeenCalledWith(
            expect.any(Buffer),
            expectedMime,
          );
        } else if (usePdf) {
          expect(mockExtractionProvider.extractPdfText).toHaveBeenCalled();
        } else if (useDirect) {
          expect(mockOcrService.extractFromBuffer).not.toHaveBeenCalled();
          expect(mockExtractionProvider.extractPdfText).not.toHaveBeenCalled();
        }
      });
    });

    it('should return application/octet-stream for unknown extensions', async () => {
      mockDb.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
        key: 'file.xyz',
      } as any);

      await expect(
        documentsService.extractTextFromFile('user-1', 'file.xyz'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('content hash generation', () => {
    it('should generate consistent hash for same content', async () => {
      mockDb.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
        key: 'test.txt',
      } as any);
      mockDb.document.update.mockResolvedValue({} as any);

      const content = 'Hello World';
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from(content)),
      });

      await documentsService.extractTextFromFile('user-1', 'test.txt');

      const updateCall = mockDb.document.update.mock.calls[0][0];
      const hash1 = updateCall.data.contentHash;

      // Reset and call again with same content
      jest.clearAllMocks();
      mockDb.document.findFirst.mockResolvedValue({
        id: 'doc-2',
        userId: 'user-1',
        key: 'test2.txt',
      } as any);
      mockDb.document.update.mockResolvedValue({} as any);
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from(content)),
      });

      await documentsService.extractTextFromFile('user-1', 'test2.txt');

      const updateCall2 = mockDb.document.update.mock.calls[0][0];
      const hash2 = updateCall2.data.contentHash;

      expect(hash1).toBe(hash2);
    });

    it('should normalize whitespace before hashing', async () => {
      mockDb.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
        key: 'test.txt',
      } as any);
      mockDb.document.update.mockResolvedValue({} as any);

      // Content with extra whitespace
      const content1 = '  Hello   World  ';
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from(content1)),
      });

      await documentsService.extractTextFromFile('user-1', 'test.txt');
      const hash1 = mockDb.document.update.mock.calls[0][0].data.contentHash;

      // Reset and call with normalized content
      jest.clearAllMocks();
      mockDb.document.findFirst.mockResolvedValue({
        id: 'doc-2',
        userId: 'user-1',
        key: 'test2.txt',
      } as any);
      mockDb.document.update.mockResolvedValue({} as any);

      const content2 = 'Hello World';
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(Buffer.from(content2)),
      });

      await documentsService.extractTextFromFile('user-1', 'test2.txt');
      const hash2 = mockDb.document.update.mock.calls[0][0].data.contentHash;

      expect(hash1).toBe(hash2);
    });
  });

  describe('analyzeDocument', () => {
    const mockDocumentWithText: any = {
      id: 'doc-1',
      userId: 'user-1',
      key: 'petition.pdf',
      type: DocumentType.petition,
      extractedText: 'This is a petition to increase minimum wage...',
      contentHash: 'abc123hash',
    };

    const mockLLMResponse = {
      text: JSON.stringify({
        summary: 'A petition to raise the minimum wage',
        keyPoints: ['Increase to $20/hour', 'Phased implementation'],
        entities: ['State Legislature', 'Workers Union'],
        actualEffect: 'Would mandate higher minimum wage',
        potentialConcerns: ['Cost to small businesses'],
        beneficiaries: ['Low-wage workers'],
        potentiallyHarmed: ['Small business owners'],
        relatedMeasures: ['Prop 15 from 2020'],
      }),
      tokensUsed: 500,
    };

    it('should analyze document and return structured result', async () => {
      mockDb.document.findFirst.mockResolvedValueOnce(mockDocumentWithText);
      mockDb.document.update.mockResolvedValue({} as any);
      mockLLMProvider.generate.mockResolvedValue(mockLLMResponse);

      const result = await documentsService.analyzeDocument('user-1', 'doc-1');

      expect(result.fromCache).toBe(false);
      expect(result.analysis.summary).toBe(
        'A petition to raise the minimum wage',
      );
      expect(result.analysis.keyPoints).toContain('Increase to $20/hour');
      expect(result.analysis.provider).toBe('Ollama');
      expect(result.analysis.model).toBe('llama3.2');

      expect(mockDb.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'ai_analysis_started' },
      });

      expect(mockDb.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          analysis: expect.objectContaining({
            summary: 'A petition to raise the minimum wage',
          }),
          status: 'ai_analysis_complete',
        },
      });
    });

    it('should return cached analysis when contentHash matches', async () => {
      const cachedAnalysis = {
        summary: 'Cached analysis',
        keyPoints: ['Point 1'],
        entities: [],
      };

      // First call returns document without analysis
      mockDb.document.findFirst
        .mockResolvedValueOnce(mockDocumentWithText)
        // Second call finds cached document with same contentHash
        .mockResolvedValueOnce({
          id: 'cached-doc',
          analysis: cachedAnalysis,
        } as any);

      const result = await documentsService.analyzeDocument('user-1', 'doc-1');

      expect(result.fromCache).toBe(true);
      expect(result.analysis.cachedFrom).toBe('cached-doc');
      expect(mockLLMProvider.generate).not.toHaveBeenCalled();
    });

    it('should bypass cache when forceReanalyze is true', async () => {
      mockDb.document.findFirst.mockResolvedValueOnce(mockDocumentWithText);
      mockDb.document.update.mockResolvedValue({} as any);
      mockLLMProvider.generate.mockResolvedValue(mockLLMResponse);

      const result = await documentsService.analyzeDocument(
        'user-1',
        'doc-1',
        true,
      );

      expect(result.fromCache).toBe(false);
      expect(mockLLMProvider.generate).toHaveBeenCalled();
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDb.document.findFirst.mockResolvedValue(null);

      await expect(
        documentsService.analyzeDocument('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when text not extracted', async () => {
      mockDb.document.findFirst.mockResolvedValue({
        ...mockDocumentWithText,
        extractedText: null,
      });

      await expect(
        documentsService.analyzeDocument('user-1', 'doc-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set status to failed when LLM throws error', async () => {
      mockDb.document.findFirst.mockResolvedValueOnce(mockDocumentWithText);
      mockDb.document.update.mockResolvedValue({} as any);
      mockLLMProvider.generate.mockRejectedValue(new Error('LLM timeout'));

      await expect(
        documentsService.analyzeDocument('user-1', 'doc-1'),
      ).rejects.toThrow('LLM timeout');

      expect(mockDb.document.update).toHaveBeenLastCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'ai_analysis_failed' },
      });
    });

    it('should handle LLM response with markdown code blocks', async () => {
      mockDb.document.findFirst.mockResolvedValueOnce(mockDocumentWithText);
      mockDb.document.update.mockResolvedValue({} as any);
      mockLLMProvider.generate.mockResolvedValue({
        text: '```json\n{"summary":"Test","keyPoints":[],"entities":[]}\n```',
        tokensUsed: 100,
      });

      const result = await documentsService.analyzeDocument('user-1', 'doc-1');

      expect(result.analysis.summary).toBe('Test');
    });

    it('should use correct prompt for different document types', async () => {
      const contractDoc = {
        ...mockDocumentWithText,
        type: DocumentType.contract,
        extractedText: 'This agreement is between Party A and Party B...',
      };

      mockDb.document.findFirst.mockResolvedValueOnce(contractDoc);
      mockDb.document.update.mockResolvedValue({} as any);
      mockLLMProvider.generate.mockResolvedValue({
        text: JSON.stringify({
          summary: 'A service contract',
          keyPoints: ['Term is 1 year'],
          entities: ['Party A', 'Party B'],
          parties: ['Party A', 'Party B'],
          obligations: ['Deliver services'],
          risks: ['Liability'],
          effectiveDate: '2024-01-01',
          terminationClause: '30 days notice',
        }),
        tokensUsed: 400,
      });

      const result = await documentsService.analyzeDocument('user-1', 'doc-1');

      expect(result.analysis.parties).toContain('Party A');
      expect(mockPromptClient.getDocumentAnalysisPrompt).toHaveBeenCalledWith({
        documentType: DocumentType.contract,
        text: 'This agreement is between Party A and Party B...',
      });
    });
  });

  describe('getDocumentAnalysis', () => {
    it('should return existing analysis', async () => {
      const storedAnalysis = {
        summary: 'Test summary',
        keyPoints: ['Point 1'],
        entities: ['Entity 1'],
      };

      mockDb.document.findFirst.mockResolvedValue({
        analysis: storedAnalysis,
      } as any);

      const result = await documentsService.getDocumentAnalysis(
        'user-1',
        'doc-1',
      );

      expect(result).toEqual(storedAnalysis);
    });

    it('should return null when no analysis exists', async () => {
      mockDb.document.findFirst.mockResolvedValue({
        analysis: null,
      } as any);

      const result = await documentsService.getDocumentAnalysis(
        'user-1',
        'doc-1',
      );

      expect(result).toBeNull();
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDb.document.findFirst.mockResolvedValue(null);

      await expect(
        documentsService.getDocumentAnalysis('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setDocumentLocation', () => {
    const mockDocument: any = {
      id: 'doc-1',
      userId: 'user-1',
      key: 'petition.pdf',
    };

    it('should set fuzzed location for document', async () => {
      mockDb.document.findFirst.mockResolvedValue(mockDocument);
      mockDb.$executeRaw.mockResolvedValue(1);

      const result = await documentsService.setDocumentLocation(
        'user-1',
        'doc-1',
        37.7749, // San Francisco lat
        -122.4194, // San Francisco lon
      );

      expect(result.success).toBe(true);
      expect(result.fuzzedLocation).toBeDefined();
      // Fuzzed location should be close but not exact (~100m)
      expect(result.fuzzedLocation!.latitude).toBeCloseTo(37.7749, 2);
      expect(result.fuzzedLocation!.longitude).toBeCloseTo(-122.4194, 2);
      expect(mockDb.$executeRaw).toHaveBeenCalled();
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDb.document.findFirst.mockResolvedValue(null);

      await expect(
        documentsService.setDocumentLocation('user-1', 'doc-1', 37.0, -122.0),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not allow setting location for other users document', async () => {
      mockDb.document.findFirst.mockResolvedValue(null); // Different user

      await expect(
        documentsService.setDocumentLocation('user-2', 'doc-1', 37.0, -122.0),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocumentLocation', () => {
    it('should return location when set', async () => {
      mockDb.document.findFirst.mockResolvedValue({ id: 'doc-1' } as any);
      mockDb.$queryRaw.mockResolvedValue([
        { latitude: 37.7749, longitude: -122.4194 },
      ]);

      const result = await documentsService.getDocumentLocation(
        'user-1',
        'doc-1',
      );

      expect(result).toEqual({
        latitude: 37.7749,
        longitude: -122.4194,
      });
    });

    it('should return null when no location set', async () => {
      mockDb.document.findFirst.mockResolvedValue({ id: 'doc-1' } as any);
      mockDb.$queryRaw.mockResolvedValue([]);

      const result = await documentsService.getDocumentLocation(
        'user-1',
        'doc-1',
      );

      expect(result).toBeNull();
    });

    it('should throw NotFoundException when document not found', async () => {
      mockDb.document.findFirst.mockResolvedValue(null);

      await expect(
        documentsService.getDocumentLocation('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findDocumentsNearLocation', () => {
    it('should find documents within radius', async () => {
      mockDb.$queryRaw.mockResolvedValue([
        { id: 'doc-1', distance_meters: 500 },
        { id: 'doc-2', distance_meters: 1500 },
      ]);

      const results = await documentsService.findDocumentsNearLocation(
        'contenthash123',
        37.7749,
        -122.4194,
        5000,
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        documentId: 'doc-1',
        distanceMeters: 500,
      });
      expect(results[1]).toEqual({
        documentId: 'doc-2',
        distanceMeters: 1500,
      });
    });

    it('should return empty array when no documents found', async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      const results = await documentsService.findDocumentsNearLocation(
        'contenthash123',
        37.7749,
        -122.4194,
      );

      expect(results).toEqual([]);
    });

    it('should use default radius of 10km', async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      await documentsService.findDocumentsNearLocation(
        'contenthash123',
        37.7749,
        -122.4194,
      );

      // The query should use 10000 meters as default
      expect(mockDb.$queryRaw).toHaveBeenCalled();
    });
  });
});

describe('DocumentsService - config validation', () => {
  it('should throw error when file config is missing', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          DocumentsService,
          { provide: DbService, useValue: createMockDbService() },
          {
            provide: 'STORAGE_PROVIDER',
            useValue: {
              getSignedUrl: jest.fn(),
              deleteFile: jest.fn(),
            },
          },
          {
            provide: 'LLM_PROVIDER',
            useValue: {
              generate: jest.fn(),
              getName: jest.fn(),
              getModelName: jest.fn(),
            },
          },
          {
            provide: OcrService,
            useValue: {},
          },
          {
            provide: ExtractionProvider,
            useValue: {},
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
          {
            provide: PromptClientService,
            useValue: {},
          },
        ],
      }).compile(),
    ).rejects.toThrow('File storage config is missing');
  });
});
