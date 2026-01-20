import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from '@qckstrt/storage-provider';
import { Document as PrismaDocument } from '@prisma/client';

import { IFileConfig } from 'src/config';
import { PrismaService } from 'src/db/prisma.service';
import { DocumentStatus } from 'src/common/enums/document.status.enum';
import { File } from './models/file.model';

/**
 * Documents Service
 *
 * Handles document metadata management and file storage operations.
 * Manages Document in PostgreSQL and file storage in S3.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name, {
    timestamp: true,
  });
  private fileConfig: IFileConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Inject('STORAGE_PROVIDER') private storage: IStorageProvider,
    private configService: ConfigService,
  ) {
    const fileConfig: IFileConfig | undefined =
      configService.get<IFileConfig>('file');

    if (!fileConfig) {
      throw new Error('File storage config is missing');
    }

    this.fileConfig = fileConfig;
  }

  /**
   * List all documents for a user
   */
  async listFiles(userId: string): Promise<File[]> {
    const documents = await this.prisma.document.findMany({
      where: { userId },
    });

    const files: File[] = documents.map((document) => ({
      userId,
      filename: document.key,
      size: document.size,
      // Cast Prisma enum to application enum - values are compatible at runtime
      status: document.status as unknown as DocumentStatus,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));

    return files;
  }

  /**
   * Get signed URL for uploading a file
   */
  getUploadUrl(userId: string, filename: string): Promise<string> {
    return this.getSignedUrl(userId, filename, true);
  }

  /**
   * Get signed URL for downloading a file
   */
  getDownloadUrl(userId: string, filename: string): Promise<string> {
    return this.getSignedUrl(userId, filename, false);
  }

  /**
   * Get S3 signed URL
   */
  private getSignedUrl(
    userId: string,
    filename: string,
    upload: boolean,
  ): Promise<string> {
    const key = `${userId}/${filename}`;
    return this.storage.getSignedUrl(this.fileConfig.bucket, key, upload);
  }

  /**
   * Delete a file and its metadata
   */
  async deleteFile(userId: string, filename: string): Promise<boolean> {
    this.logger.log(`Deleting file ${filename} for user ${userId}`);

    try {
      // Delete from S3
      const key = `${userId}/${filename}`;
      const deleted = await this.storage.deleteFile(
        this.fileConfig.bucket,
        key,
      );

      if (deleted) {
        // Delete metadata from database
        await this.prisma.document.deleteMany({
          where: { userId, key: filename },
        });
        this.logger.log(`Deleted file ${filename} successfully`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete file ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Get document by ID
   */
  async getDocumentById(documentId: string): Promise<PrismaDocument | null> {
    return this.prisma.document.findUnique({
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
  ): Promise<PrismaDocument> {
    return this.prisma.document.create({
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
    updates: Partial<PrismaDocument>,
  ): Promise<void> {
    await this.prisma.document.update({
      where: { id },
      data: updates,
    });
  }
}
