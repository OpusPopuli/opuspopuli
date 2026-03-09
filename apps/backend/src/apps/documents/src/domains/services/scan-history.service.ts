import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';

import { DocumentAnalysis } from '../dto/analysis.dto';
import {
  ScanHistoryItem,
  PaginatedScanHistory,
  ScanDetailResult,
  ScanHistoryFiltersInput,
} from '../dto/scan-history.dto';

/**
 * Scan History Service
 *
 * Provides paginated scan history, detail views, and soft-delete
 * operations for user documents.
 */
@Injectable()
export class ScanHistoryService {
  private readonly logger = new Logger(ScanHistoryService.name, {
    timestamp: true,
  });

  constructor(private readonly db: DbService) {}

  /**
   * Get paginated scan history for a user
   */
  async getScanHistory(
    userId: string,
    skip: number,
    take: number,
    filters?: ScanHistoryFiltersInput,
  ): Promise<PaginatedScanHistory> {
    const where: Prisma.DocumentWhereInput = {
      userId,
      deletedAt: null,
    };

    if (filters?.search) {
      where.extractedText = { contains: filters.search, mode: 'insensitive' };
    }

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters?.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters?.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    const [documents, total] = await Promise.all([
      this.db.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          type: true,
          status: true,
          analysis: true,
          ocrConfidence: true,
          createdAt: true,
        },
      }),
      this.db.document.count({ where }),
    ]);

    const items: ScanHistoryItem[] = documents.map((doc) => {
      const analysis = doc.analysis as Record<string, unknown> | null;
      return {
        id: doc.id,
        type: doc.type,
        status: doc.status,
        summary: (analysis?.summary as string) ?? undefined,
        ocrConfidence: doc.ocrConfidence ?? undefined,
        hasAnalysis: analysis !== null,
        createdAt: doc.createdAt,
      };
    });

    return {
      items,
      total,
      hasMore: skip + take < total,
    };
  }

  /**
   * Get detailed scan result for a single document (ownership enforced)
   */
  async getScanDetail(
    userId: string,
    documentId: string,
  ): Promise<ScanDetailResult> {
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId, deletedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const analysis = document.analysis as unknown as DocumentAnalysis | null;

    return {
      id: document.id,
      type: document.type,
      status: document.status,
      extractedText: document.extractedText ?? undefined,
      ocrConfidence: document.ocrConfidence ?? undefined,
      ocrProvider: document.ocrProvider ?? undefined,
      analysis: analysis ?? undefined,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  /**
   * Soft-delete a document (ownership enforced)
   */
  async softDeleteDocument(
    userId: string,
    documentId: string,
  ): Promise<boolean> {
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId, deletedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.db.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Soft-deleted document ${documentId} for user ${userId}`);
    return true;
  }

  /**
   * Soft-delete all documents for a user
   */
  async deleteAllUserScans(userId: string): Promise<number> {
    const result = await this.db.document.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    this.logger.log(
      `Soft-deleted ${result.count} documents for user ${userId}`,
    );
    return result.count;
  }
}
