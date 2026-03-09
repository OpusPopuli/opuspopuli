import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  DbService,
  AbuseReportReason,
} from '@opuspopuli/relationaldb-provider';

import { AbuseReportService } from './abuse-report.service';

describe('AbuseReportService', () => {
  let service: AbuseReportService;
  let db: {
    document: {
      findUnique: jest.Mock;
    };
    abuseReport: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    db = {
      document: {
        findUnique: jest.fn(),
      },
      abuseReport: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AbuseReportService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get<AbuseReportService>(AbuseReportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitAbuseReport', () => {
    it('should create an abuse report successfully', async () => {
      db.document.findUnique.mockResolvedValue({ id: 'doc-1' });
      db.abuseReport.findFirst.mockResolvedValue(null);
      db.abuseReport.create.mockResolvedValue({ id: 'report-1' });

      const result = await service.submitAbuseReport(
        'reporter-1',
        'doc-1',
        'incorrect_analysis' as AbuseReportReason,
        'The summary is wrong',
      );

      expect(result).toEqual({ success: true, reportId: 'report-1' });
      expect(db.abuseReport.create).toHaveBeenCalledWith({
        data: {
          documentId: 'doc-1',
          reporterId: 'reporter-1',
          reason: 'incorrect_analysis',
          description: 'The summary is wrong',
        },
      });
    });

    it('should create report without description', async () => {
      db.document.findUnique.mockResolvedValue({ id: 'doc-1' });
      db.abuseReport.findFirst.mockResolvedValue(null);
      db.abuseReport.create.mockResolvedValue({ id: 'report-2' });

      const result = await service.submitAbuseReport(
        'reporter-1',
        'doc-1',
        'other' as AbuseReportReason,
      );

      expect(result.success).toBe(true);
      expect(db.abuseReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ description: null }),
      });
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findUnique.mockResolvedValue(null);

      await expect(
        service.submitAbuseReport(
          'reporter-1',
          'nonexistent',
          'other' as AbuseReportReason,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on duplicate report', async () => {
      db.document.findUnique.mockResolvedValue({ id: 'doc-1' });
      db.abuseReport.findFirst.mockResolvedValue({ id: 'existing-report' });

      await expect(
        service.submitAbuseReport(
          'reporter-1',
          'doc-1',
          'incorrect_analysis' as AbuseReportReason,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(db.abuseReport.create).not.toHaveBeenCalled();
    });
  });
});
