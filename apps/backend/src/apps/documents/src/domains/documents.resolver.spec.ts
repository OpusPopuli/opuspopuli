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

  describe('analyzeDocument', () => {
    it('should call service and return analysis with provenance fields', async () => {
      const mockResult = {
        analysis: {
          documentType: 'petition',
          summary: 'Petition summary',
          keyPoints: ['Point 1'],
          entities: ['Entity 1'],
          analyzedAt: new Date().toISOString(),
          provider: 'Ollama',
          model: 'llama3.2',
          processingTimeMs: 1000,
          promptVersion: 'v2',
          promptHash: 'abc123hash',
          sources: [
            {
              name: 'Scanned Document (OCR)',
              accessedAt: new Date().toISOString(),
              dataCompleteness: 100,
            },
          ],
          completenessScore: 80,
          completenessDetails: {
            availableCount: 4,
            idealCount: 5,
            missingItems: ['Financial impact data'],
            explanation: 'Based on 4 of 5 sources.',
          },
        },
        fromCache: false,
      };

      documentsService.analyzeDocument = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await documentsResolver.analyzeDocument(
        { documentId: 'doc-1' },
        mockContext,
      );

      expect(result).toEqual(mockResult);
      expect(documentsService.analyzeDocument).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
        false,
      );
      expect(result.analysis.promptVersion).toBe('v2');
      expect(result.analysis.promptHash).toBe('abc123hash');
      expect(result.analysis.sources).toHaveLength(1);
      expect(result.analysis.completenessScore).toBe(80);
      expect(result.analysis.completenessDetails!.missingItems).toContain(
        'Financial impact data',
      );
    });

    it('should pass through forceReanalyze flag', async () => {
      documentsService.analyzeDocument = jest
        .fn()
        .mockResolvedValue({ analysis: {}, fromCache: false });

      await documentsResolver.analyzeDocument(
        { documentId: 'doc-1', forceReanalyze: true },
        mockContext,
      );

      expect(documentsService.analyzeDocument).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
        true,
      );
    });

    it('should throw error when user not authenticated', async () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      await expect(
        documentsResolver.analyzeDocument(
          { documentId: 'doc-1' },
          noUserContext,
        ),
      ).rejects.toThrow('User not authenticated');
    });
  });

  describe('petitionActivityFeed', () => {
    it('should call service and return feed', async () => {
      const mockFeed = {
        items: [],
        hourlyTrend: [],
        totalScansLast24h: 10,
        activePetitionsLast24h: 3,
      };
      documentsService.getPetitionActivityFeed = jest
        .fn()
        .mockResolvedValue(mockFeed);

      const result = await documentsResolver.petitionActivityFeed();

      expect(result).toEqual(mockFeed);
      expect(documentsService.getPetitionActivityFeed).toHaveBeenCalled();
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

  // ============================================
  // PETITION-BALLOT LINKING
  // ============================================

  describe('linkedPropositions', () => {
    it('should return linked propositions for a document', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          propositionId: 'prop-1',
          title: 'Proposition 47',
          summary: 'Criminal sentencing reform',
          status: 'PENDING',
          linkSource: 'auto_analysis',
          confidence: 0.8,
          linkedAt: new Date(),
        },
      ];
      documentsService.getLinkedPropositions = jest
        .fn()
        .mockResolvedValue(mockLinks);

      const result = await documentsResolver.linkedPropositions('doc-1');

      expect(result).toEqual(mockLinks);
      expect(documentsService.getLinkedPropositions).toHaveBeenCalledWith(
        'doc-1',
      );
    });
  });

  describe('petitionDocumentsForProposition', () => {
    it('should return petition documents for a proposition', async () => {
      const mockDocs = [
        {
          id: 'link-1',
          documentId: 'doc-1',
          summary: 'A petition about parks',
          linkSource: 'user_manual',
          linkedAt: new Date(),
        },
      ];
      documentsService.getLinkedPetitionDocuments = jest
        .fn()
        .mockResolvedValue(mockDocs);

      const result =
        await documentsResolver.petitionDocumentsForProposition('prop-1');

      expect(result).toEqual(mockDocs);
      expect(documentsService.getLinkedPetitionDocuments).toHaveBeenCalledWith(
        'prop-1',
      );
    });
  });

  describe('searchPropositions', () => {
    it('should search and return results', async () => {
      const mockResults = [
        {
          id: 'prop-1',
          title: 'Proposition 47',
          externalId: 'Prop 47',
          status: 'PENDING',
        },
      ];
      documentsService.searchPropositions = jest
        .fn()
        .mockResolvedValue(mockResults);

      const result = await documentsResolver.searchPropositions('proposition');

      expect(result).toEqual(mockResults);
      expect(documentsService.searchPropositions).toHaveBeenCalledWith(
        'proposition',
      );
    });
  });

  describe('linkDocumentToProposition', () => {
    it('should link and return result', async () => {
      const mockResult = { success: true, linkId: 'link-1' };
      documentsService.linkDocumentToProposition = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await documentsResolver.linkDocumentToProposition(
        { documentId: 'doc-1', propositionId: 'prop-1' },
        mockContext,
      );

      expect(result).toEqual(mockResult);
      expect(documentsService.linkDocumentToProposition).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
        'prop-1',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      await expect(
        documentsResolver.linkDocumentToProposition(
          { documentId: 'doc-1', propositionId: 'prop-1' },
          noUserContext,
        ),
      ).rejects.toThrow('User not authenticated');
    });
  });

  describe('unlinkDocumentFromProposition', () => {
    it('should unlink and return true', async () => {
      documentsService.unlinkDocumentFromProposition = jest
        .fn()
        .mockResolvedValue(true);

      const result = await documentsResolver.unlinkDocumentFromProposition(
        { documentId: 'doc-1', propositionId: 'prop-1' },
        mockContext,
      );

      expect(result).toBe(true);
      expect(
        documentsService.unlinkDocumentFromProposition,
      ).toHaveBeenCalledWith('user-1', 'doc-1', 'prop-1');
    });
  });
});
