import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from '@opuspopuli/storage-provider';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { FileService } from './file.service';

describe('FileService', () => {
  let service: FileService;
  let db: {
    document: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let storage: jest.Mocked<IStorageProvider>;

  beforeEach(async () => {
    db = {
      document: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    storage = createMock<IStorageProvider>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: DbService, useValue: db },
        { provide: 'STORAGE_PROVIDER', useValue: storage },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({ bucket: 'test-bucket' }),
          },
        },
      ],
    }).compile();

    service = module.get<FileService>(FileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listFiles', () => {
    it('should return mapped files for a user', async () => {
      const mockDocs = [
        {
          key: 'file1.pdf',
          size: 1024,
          status: 'ai_analysis_complete',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];
      db.document.findMany.mockResolvedValue(mockDocs);

      const result = await service.listFiles('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-1');
      expect(result[0].filename).toBe('file1.pdf');
      expect(result[0].size).toBe(1024);
      expect(db.document.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should return empty array when user has no files', async () => {
      db.document.findMany.mockResolvedValue([]);

      const result = await service.listFiles('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('getUploadUrl', () => {
    it('should return a signed upload URL', async () => {
      storage.getSignedUrl.mockResolvedValue('https://s3.example.com/upload');

      const result = await service.getUploadUrl('user-1', 'file.pdf');

      expect(result).toBe('https://s3.example.com/upload');
      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        'test-bucket',
        'user-1/file.pdf',
        true,
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should return a signed download URL', async () => {
      storage.getSignedUrl.mockResolvedValue('https://s3.example.com/download');

      const result = await service.getDownloadUrl('user-1', 'file.pdf');

      expect(result).toBe('https://s3.example.com/download');
      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        'test-bucket',
        'user-1/file.pdf',
        false,
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file from storage and database', async () => {
      storage.deleteFile.mockResolvedValue(true);
      db.document.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteFile('user-1', 'file.pdf');

      expect(result).toBe(true);
      expect(storage.deleteFile).toHaveBeenCalledWith(
        'test-bucket',
        'user-1/file.pdf',
      );
      expect(db.document.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', key: 'file.pdf' },
      });
    });

    it('should not delete from database if storage delete fails', async () => {
      storage.deleteFile.mockResolvedValue(false);

      const result = await service.deleteFile('user-1', 'file.pdf');

      expect(result).toBe(false);
      expect(db.document.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw error when storage throws', async () => {
      storage.deleteFile.mockRejectedValue(new Error('Storage error'));

      await expect(service.deleteFile('user-1', 'file.pdf')).rejects.toThrow(
        'Storage error',
      );
    });
  });
});
