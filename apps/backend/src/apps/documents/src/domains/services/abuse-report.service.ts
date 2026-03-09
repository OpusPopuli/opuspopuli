import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DbService,
  AbuseReportReason,
} from '@opuspopuli/relationaldb-provider';

import { SubmitAbuseReportResult } from '../dto/abuse-report.dto';

/**
 * Abuse Report Service
 *
 * Handles submission of abuse reports for document analyses.
 */
@Injectable()
export class AbuseReportService {
  private readonly logger = new Logger(AbuseReportService.name, {
    timestamp: true,
  });

  constructor(private readonly db: DbService) {}

  /**
   * Submit an abuse report for a document analysis.
   * Any authenticated user can report any document.
   */
  async submitAbuseReport(
    reporterId: string,
    documentId: string,
    reason: AbuseReportReason,
    description?: string,
  ): Promise<SubmitAbuseReportResult> {
    const document = await this.db.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const existing = await this.db.abuseReport.findFirst({
      where: { documentId, reporterId },
    });

    if (existing) {
      throw new BadRequestException('You have already reported this document');
    }

    const report = await this.db.abuseReport.create({
      data: {
        documentId,
        reporterId,
        reason,
        description: description ?? null,
      },
    });

    this.logger.log(
      `Abuse report ${report.id} created: document=${documentId}, reporter=${reporterId}, reason=${reason}`,
    );

    return {
      success: true,
      reportId: report.id,
    };
  }
}
