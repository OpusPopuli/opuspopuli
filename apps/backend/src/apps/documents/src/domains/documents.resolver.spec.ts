import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { DocumentsResolver } from './documents.resolver';
import { DocumentsService } from './documents.service';
import { File } from './models/file.model';
import { DocumentStatus } from 'src/common/enums/document.status.enum';
import { SubmitAbuseReportInput } from './dto/abuse-report.dto';

describe('DocumentsResolver', () => {
  let documentsResolver: DocumentsResolver;
  let documentsService: DocumentsService;

  const mockUser = {
    id: 'user-1',
    email: 'user@example.com',
    roles: ['User'],
    department: 'Engineering',
    clearance: 'Secret',
  };

  // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
  // @see https://github.com/OpusPopuli/opuspopuli/issues/183
  const mockContext = {
    req: {
      user: mockUser,
      headers: {},
    },
  };

  const mockFiles: File[] = [
    {
      userId: 'user-1',
      filename: 'file1.pdf',
      size: 1024,
      status: DocumentStatus.AIEMBEDDINGSCOMPLETE,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      userId: 'user-1',
      filename: 'file2.txt',
      size: 512,
      status: DocumentStatus.PROCESSINGNPENDING,
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsResolver,
        {
          provide: DocumentsService,
          useValue: createMock<DocumentsService>(),
        },
      ],
    }).compile();

    documentsResolver = module.get<DocumentsResolver>(DocumentsResolver);
    documentsService = module.get<DocumentsService>(DocumentsService);
  });

  it('resolver and services should be defined', () => {
    expect(documentsResolver).toBeDefined();
    expect(documentsService).toBeDefined();
  });

  describe('listFiles', () => {
    it('should return list of files for authenticated user', async () => {
      documentsService.listFiles = jest.fn().mockResolvedValue(mockFiles);

      const result = await documentsResolver.listFiles(mockContext);

      expect(result).toEqual(mockFiles);
      expect(documentsService.listFiles).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no files found', async () => {
      documentsService.listFiles = jest.fn().mockResolvedValue([]);

      const result = await documentsResolver.listFiles(mockContext);

      expect(result).toEqual([]);
    });

    it('should throw error when user not authenticated', () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      expect(() => documentsResolver.listFiles(noUserContext)).toThrow(
        'User not authenticated',
      );
    });
  });

  describe('getUploadUrl', () => {
    it('should return upload URL for authenticated user', async () => {
      const mockUrl = 'https://s3.example.com/upload-url';
      documentsService.getUploadUrl = jest.fn().mockResolvedValue(mockUrl);

      const result = await documentsResolver.getUploadUrl(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(mockUrl);
      expect(documentsService.getUploadUrl).toHaveBeenCalledWith(
        'user-1',
        'test.pdf',
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should return download URL for authenticated user', async () => {
      const mockUrl = 'https://s3.example.com/download-url';
      documentsService.getDownloadUrl = jest.fn().mockResolvedValue(mockUrl);

      const result = await documentsResolver.getDownloadUrl(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(mockUrl);
      expect(documentsService.getDownloadUrl).toHaveBeenCalledWith(
        'user-1',
        'test.pdf',
      );
    });
  });

  describe('deleteFile', () => {
    it('should return true when file is deleted', async () => {
      documentsService.deleteFile = jest.fn().mockResolvedValue(true);

      const result = await documentsResolver.deleteFile(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(true);
      expect(documentsService.deleteFile).toHaveBeenCalledWith(
        'user-1',
        'test.pdf',
      );
    });

    it('should return false when file deletion fails', async () => {
      documentsService.deleteFile = jest.fn().mockResolvedValue(false);

      const result = await documentsResolver.deleteFile(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(false);
    });
  });

  describe('user', () => {
    it('should resolve user field', () => {
      const file = mockFiles[0];

      const result = documentsResolver.user(file);

      expect(result).toEqual({ id: 'user-1' });
    });
  });

  describe('submitAbuseReport', () => {
    it('should call service with correct arguments', async () => {
      const mockResult = { success: true, reportId: 'report-1' };
      documentsService.submitAbuseReport = jest
        .fn()
        .mockResolvedValue(mockResult);

      const input: SubmitAbuseReportInput = {
        documentId: 'doc-1',
        reason: 'incorrect_analysis' as SubmitAbuseReportInput['reason'],
        description: 'Summary is wrong',
      };

      const result = await documentsResolver.submitAbuseReport(
        input,
        mockContext,
      );

      expect(result).toEqual(mockResult);
      expect(documentsService.submitAbuseReport).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
        'incorrect_analysis',
        'Summary is wrong',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      await expect(
        documentsResolver.submitAbuseReport(
          {
            documentId: 'doc-1',
            reason: 'other' as SubmitAbuseReportInput['reason'],
          },
          noUserContext,
        ),
      ).rejects.toThrow('User not authenticated');
    });
  });
});
