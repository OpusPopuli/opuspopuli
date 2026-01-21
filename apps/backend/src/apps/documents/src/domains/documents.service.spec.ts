/* eslint-disable @typescript-eslint/no-explicit-any */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { DocumentsService } from './documents.service';
import { DbService } from '@qckstrt/relationaldb-provider';
import { createMockDbService } from '@qckstrt/relationaldb-provider/testing';
import { IStorageProvider } from '@qckstrt/storage-provider';
import { DocumentStatus } from 'src/common/enums/document.status.enum';

describe('DocumentsService', () => {
  let documentsService: DocumentsService;
  let mockDb: ReturnType<typeof createMockDbService>;
  let storage: IStorageProvider;

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

  beforeEach(async () => {
    mockDb = createMockDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DbService, useValue: mockDb },
        {
          provide: 'STORAGE_PROVIDER',
          useValue: mockStorageProvider,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(mockFileConfig),
          },
        },
      ],
    }).compile();

    documentsService = module.get<DocumentsService>(DocumentsService);
    storage = module.get<IStorageProvider>('STORAGE_PROVIDER');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('services should be defined', () => {
    expect(documentsService).toBeDefined();
    expect(storage).toBeDefined();
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
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile(),
    ).rejects.toThrow('File storage config is missing');
  });
});
