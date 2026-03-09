import { Injectable } from '@nestjs/common';
import {
  DbService,
  Document as DbDocument,
  Prisma,
} from '@opuspopuli/relationaldb-provider';

/**
 * Document CRUD Service
 *
 * Shared data-access helpers for document records.
 * Used by ScanService and AnalysisService to avoid circular deps.
 */
@Injectable()
export class DocumentCrudService {
  constructor(private readonly db: DbService) {}

  /**
   * Get document by ID
   */
  async getDocumentById(documentId: string): Promise<DbDocument | null> {
    return this.db.document.findUnique({
      where: { id: documentId },
    });
  }

  /**
   * Create document metadata
   */
  async createDocument(
    location: string,
    userId: string,
    key: string,
    size: number,
    checksum: string,
  ): Promise<DbDocument> {
    return this.db.document.create({
      data: {
        location,
        userId,
        key,
        size,
        checksum,
      },
    });
  }

  /**
   * Update document metadata
   */
  async updateDocument(
    id: string,
    updates: Prisma.DocumentUpdateInput,
  ): Promise<void> {
    await this.db.document.update({
      where: { id },
      data: updates,
    });
  }
}
