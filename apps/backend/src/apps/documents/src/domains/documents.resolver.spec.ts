import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { DocumentsResolver } from './documents.resolver';
import { File } from './models/file.model';
import { DocumentStatus } from 'src/common/enums/document.status.enum';
import { SubmitAbuseReportInput } from './dto/abuse-report.dto';

import { FileService } from './services/file.service';
import { ScanService } from './services/scan.service';
import { AnalysisService } from './services/analysis.service';
import { LocationService } from './services/location.service';
import { LinkingService } from './services/linking.service';
import { AbuseReportService } from './services/abuse-report.service';
import { ActivityFeedService } from './services/activity-feed.service';
import { ScanHistoryService } from './services/scan-history.service';

describe('DocumentsResolver', () => {
  let documentsResolver: DocumentsResolver;
  let fileService: FileService;
  let scanService: ScanService;
  let analysisService: AnalysisService;
  let locationService: LocationService;
  let linkingService: LinkingService;
  let abuseReportService: AbuseReportService;
  let activityFeedService: ActivityFeedService;
  let scanHistoryService: ScanHistoryService;

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
        { provide: FileService, useValue: createMock<FileService>() },
        { provide: ScanService, useValue: createMock<ScanService>() },
        { provide: AnalysisService, useValue: createMock<AnalysisService>() },
        { provide: LocationService, useValue: createMock<LocationService>() },
        { provide: LinkingService, useValue: createMock<LinkingService>() },
        {
          provide: AbuseReportService,
          useValue: createMock<AbuseReportService>(),
        },
        {
          provide: ActivityFeedService,
          useValue: createMock<ActivityFeedService>(),
        },
        {
          provide: ScanHistoryService,
          useValue: createMock<ScanHistoryService>(),
        },
      ],
    }).compile();

    documentsResolver = module.get<DocumentsResolver>(DocumentsResolver);
    fileService = module.get<FileService>(FileService);
    scanService = module.get<ScanService>(ScanService);
    analysisService = module.get<AnalysisService>(AnalysisService);
    locationService = module.get<LocationService>(LocationService);
    linkingService = module.get<LinkingService>(LinkingService);
    abuseReportService = module.get<AbuseReportService>(AbuseReportService);
    activityFeedService = module.get<ActivityFeedService>(ActivityFeedService);
    scanHistoryService = module.get<ScanHistoryService>(ScanHistoryService);
  });

  it('resolver and services should be defined', () => {
    expect(documentsResolver).toBeDefined();
    expect(fileService).toBeDefined();
    expect(scanService).toBeDefined();
    expect(analysisService).toBeDefined();
    expect(locationService).toBeDefined();
    expect(linkingService).toBeDefined();
    expect(abuseReportService).toBeDefined();
    expect(activityFeedService).toBeDefined();
    expect(scanHistoryService).toBeDefined();
  });

  describe('listFiles', () => {
    it('should return list of files for authenticated user', async () => {
      fileService.listFiles = jest.fn().mockResolvedValue(mockFiles);

      const result = await documentsResolver.listFiles(mockContext);

      expect(result).toEqual(mockFiles);
      expect(fileService.listFiles).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no files found', async () => {
      fileService.listFiles = jest.fn().mockResolvedValue([]);

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
      fileService.getUploadUrl = jest.fn().mockResolvedValue(mockUrl);

      const result = await documentsResolver.getUploadUrl(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(mockUrl);
      expect(fileService.getUploadUrl).toHaveBeenCalledWith(
        'user-1',
        'test.pdf',
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should return download URL for authenticated user', async () => {
      const mockUrl = 'https://s3.example.com/download-url';
      fileService.getDownloadUrl = jest.fn().mockResolvedValue(mockUrl);

      const result = await documentsResolver.getDownloadUrl(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(mockUrl);
      expect(fileService.getDownloadUrl).toHaveBeenCalledWith(
        'user-1',
        'test.pdf',
      );
    });
  });

  describe('deleteFile', () => {
    it('should return true when file is deleted', async () => {
      fileService.deleteFile = jest.fn().mockResolvedValue(true);

      const result = await documentsResolver.deleteFile(
        { filename: 'test.pdf' },
        mockContext,
      );

      expect(result).toBe(true);
      expect(fileService.deleteFile).toHaveBeenCalledWith('user-1', 'test.pdf');
    });

    it('should return false when file deletion fails', async () => {
      fileService.deleteFile = jest.fn().mockResolvedValue(false);

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

      analysisService.analyzeDocument = jest.fn().mockResolvedValue(mockResult);

      const result = await documentsResolver.analyzeDocument(
        { documentId: 'doc-1' },
        mockContext,
      );

      expect(result).toEqual(mockResult);
      expect(analysisService.analyzeDocument).toHaveBeenCalledWith(
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
      analysisService.analyzeDocument = jest
        .fn()
        .mockResolvedValue({ analysis: {}, fromCache: false });

      await documentsResolver.analyzeDocument(
        { documentId: 'doc-1', forceReanalyze: true },
        mockContext,
      );

      expect(analysisService.analyzeDocument).toHaveBeenCalledWith(
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
      activityFeedService.getPetitionActivityFeed = jest
        .fn()
        .mockResolvedValue(mockFeed);

      const result = await documentsResolver.petitionActivityFeed();

      expect(result).toEqual(mockFeed);
      expect(activityFeedService.getPetitionActivityFeed).toHaveBeenCalled();
    });
  });

  describe('submitAbuseReport', () => {
    it('should call service with correct arguments', async () => {
      const mockResult = { success: true, reportId: 'report-1' };
      abuseReportService.submitAbuseReport = jest
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
      expect(abuseReportService.submitAbuseReport).toHaveBeenCalledWith(
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
  // SCAN HISTORY
  // ============================================

  describe('myScanHistory', () => {
    it('should return paginated scan history', async () => {
      const mockResult = {
        items: [
          {
            id: 'doc-1',
            type: 'petition',
            status: 'ai_analysis_complete',
            summary: 'Test summary',
            ocrConfidence: 95.5,
            hasAnalysis: true,
            createdAt: new Date(),
          },
        ],
        total: 1,
        hasMore: false,
      };
      scanHistoryService.getScanHistory = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await documentsResolver.myScanHistory(
        { skip: 0, take: 10 },
        undefined,
        mockContext,
      );

      expect(result).toEqual(mockResult);
      expect(scanHistoryService.getScanHistory).toHaveBeenCalledWith(
        'user-1',
        0,
        10,
        undefined,
      );
    });

    it('should pass filters through', async () => {
      const mockResult = { items: [], total: 0, hasMore: false };
      scanHistoryService.getScanHistory = jest
        .fn()
        .mockResolvedValue(mockResult);

      const filters = { search: 'parks' };
      await documentsResolver.myScanHistory(
        { skip: 0, take: 10 },
        filters,
        mockContext,
      );

      expect(scanHistoryService.getScanHistory).toHaveBeenCalledWith(
        'user-1',
        0,
        10,
        filters,
      );
    });
  });

  describe('scanDetail', () => {
    it('should return scan detail for a document', async () => {
      const mockDetail = {
        id: 'doc-1',
        type: 'petition',
        status: 'ai_analysis_complete',
        extractedText: 'Some text',
        ocrConfidence: 95.5,
        analysis: { summary: 'Test' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scanHistoryService.getScanDetail = jest
        .fn()
        .mockResolvedValue(mockDetail);

      const result = await documentsResolver.scanDetail('doc-1', mockContext);

      expect(result).toEqual(mockDetail);
      expect(scanHistoryService.getScanDetail).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      await expect(
        documentsResolver.scanDetail('doc-1', noUserContext),
      ).rejects.toThrow('User not authenticated');
    });
  });

  describe('softDeleteScan', () => {
    it('should soft-delete and return true', async () => {
      scanHistoryService.softDeleteDocument = jest.fn().mockResolvedValue(true);

      const result = await documentsResolver.softDeleteScan(
        'doc-1',
        mockContext,
      );

      expect(result).toBe(true);
      expect(scanHistoryService.softDeleteDocument).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      await expect(
        documentsResolver.softDeleteScan('doc-1', noUserContext),
      ).rejects.toThrow('User not authenticated');
    });
  });

  describe('deleteAllMyScans', () => {
    it('should delete all scans and return count', async () => {
      scanHistoryService.deleteAllUserScans = jest.fn().mockResolvedValue(5);

      const result = await documentsResolver.deleteAllMyScans(mockContext);

      expect(result).toEqual({ deletedCount: 5 });
      expect(scanHistoryService.deleteAllUserScans).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const noUserContext = { req: { user: undefined, headers: {} } };

      await expect(
        documentsResolver.deleteAllMyScans(noUserContext),
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
      linkingService.getLinkedPropositions = jest
        .fn()
        .mockResolvedValue(mockLinks);

      const result = await documentsResolver.linkedPropositions('doc-1');

      expect(result).toEqual(mockLinks);
      expect(linkingService.getLinkedPropositions).toHaveBeenCalledWith(
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
      linkingService.getLinkedPetitionDocuments = jest
        .fn()
        .mockResolvedValue(mockDocs);

      const result =
        await documentsResolver.petitionDocumentsForProposition('prop-1');

      expect(result).toEqual(mockDocs);
      expect(linkingService.getLinkedPetitionDocuments).toHaveBeenCalledWith(
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
      linkingService.searchPropositions = jest
        .fn()
        .mockResolvedValue(mockResults);

      const result = await documentsResolver.searchPropositions('proposition');

      expect(result).toEqual(mockResults);
      expect(linkingService.searchPropositions).toHaveBeenCalledWith(
        'proposition',
      );
    });
  });

  describe('linkDocumentToProposition', () => {
    it('should link and return result', async () => {
      const mockResult = { success: true, linkId: 'link-1' };
      linkingService.linkDocumentToProposition = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await documentsResolver.linkDocumentToProposition(
        { documentId: 'doc-1', propositionId: 'prop-1' },
        mockContext,
      );

      expect(result).toEqual(mockResult);
      expect(linkingService.linkDocumentToProposition).toHaveBeenCalledWith(
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
      linkingService.unlinkDocumentFromProposition = jest
        .fn()
        .mockResolvedValue(true);

      const result = await documentsResolver.unlinkDocumentFromProposition(
        { documentId: 'doc-1', propositionId: 'prop-1' },
        mockContext,
      );

      expect(result).toBe(true);
      expect(linkingService.unlinkDocumentFromProposition).toHaveBeenCalledWith(
        'user-1',
        'doc-1',
        'prop-1',
      );
    });
  });
});
