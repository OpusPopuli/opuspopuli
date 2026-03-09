import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from '@opuspopuli/storage-provider';
import { DbService, DocumentType } from '@opuspopuli/relationaldb-provider';
import { OcrService } from '@opuspopuli/ocr-provider';
import { ExtractionProvider } from '@opuspopuli/extraction-provider';
import { createHash } from 'node:crypto';

import { IFileConfig } from 'src/config';
import { MetricsService } from 'src/common/metrics';
import { ExtractTextResult } from '../dto/ocr.dto';
import { ProcessScanResult } from '../dto/scan.dto';
import { FileService } from './file.service';

/**
 * Scan Service
 *
 * Handles scan processing pipeline: camera capture, file storage,
 * text extraction via OCR/PDF parsing.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name, { timestamp: true });
  private fileConfig: IFileConfig;

  constructor(
    private readonly db: DbService,
    @Inject('STORAGE_PROVIDER') private storage: IStorageProvider,
    private configService: ConfigService,
    private readonly ocrService: OcrService,
    private readonly extractionProvider: ExtractionProvider,
    private readonly metricsService: MetricsService,
    private readonly fileService: FileService,
  ) {
    const fileConfig: IFileConfig | undefined =
      configService.get<IFileConfig>('file');

    if (!fileConfig) {
      throw new Error('File storage config is missing');
    }

    this.fileConfig = fileConfig;
  }

  /**
   * Process a camera scan: create document, store file, extract text via OCR
   * Bridges the gap between camera capture and the analyzeDocument pipeline
   */
  async processScan(
    userId: string,
    data: string,
    mimeType: string,
    documentType: DocumentType = DocumentType.petition,
  ): Promise<ProcessScanResult> {
    const startTime = Date.now();
    this.logger.log(
      `Processing scan for user ${userId} (type: ${documentType})`,
    );

    const buffer = Buffer.from(data, 'base64');
    const checksum = createHash('sha256').update(buffer).digest('hex');

    // Generate filename from timestamp + checksum prefix
    const extension = mimeType.split('/')[1] || 'png';
    const filename = `scan-${Date.now()}-${checksum.substring(0, 8)}.${extension}`;
    const storageKey = `${userId}/${filename}`;

    // Create document record in DB
    const document = await this.db.document.create({
      data: {
        location: `${this.fileConfig.bucket}/${storageKey}`,
        userId,
        key: filename,
        size: buffer.length,
        checksum,
        status: 'text_extraction_started',
        type: documentType,
      },
    });

    try {
      // Upload to object storage via signed URL
      const uploadUrl = await this.storage.getSignedUrl(
        this.fileConfig.bucket,
        storageKey,
        true,
      );
      await fetch(uploadUrl, {
        method: 'PUT',
        body: buffer,
        headers: { 'Content-Type': mimeType },
      });

      // Extract text via OCR
      const extractedText = await this.extractTextFromBuffer(buffer, mimeType);

      // Calculate content hash for deduplication
      const contentHash = this.hashText(extractedText.text);

      // Update document with extracted text
      await this.db.document.update({
        where: { id: document.id },
        data: {
          extractedText: extractedText.text,
          contentHash,
          ocrConfidence: extractedText.confidence,
          ocrProvider: extractedText.provider,
          status: 'text_extraction_complete',
        },
      });

      this.logger.log(
        `Scan processed: document ${document.id}, ${extractedText.text.length} chars, ${extractedText.confidence.toFixed(1)}% confidence`,
      );

      this.metricsService.recordScanProcessed(
        'documents-service',
        documentType,
        'success',
        (Date.now() - startTime) / 1000,
      );
      this.metricsService.recordOcrExtraction(
        'documents-service',
        extractedText.provider,
        'success',
        extractedText.confidence,
      );

      return {
        documentId: document.id,
        text: extractedText.text,
        confidence: extractedText.confidence,
        provider: extractedText.provider,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      // Update status to failed on error
      await this.db.document.update({
        where: { id: document.id },
        data: { status: 'text_extraction_failed' },
      });
      this.metricsService.recordScanProcessed(
        'documents-service',
        documentType,
        'failure',
        (Date.now() - startTime) / 1000,
      );
      this.metricsService.recordOcrExtraction(
        'documents-service',
        'unknown',
        'failure',
      );
      throw error;
    }
  }

  /**
   * Extract text from an uploaded file
   * Routes to appropriate extractor based on MIME type
   */
  async extractTextFromFile(
    userId: string,
    filename: string,
  ): Promise<ExtractTextResult> {
    this.logger.log(`Extracting text from file ${filename} for user ${userId}`);

    // Get document metadata
    const document = await this.db.document.findFirst({
      where: { userId, key: filename },
    });

    if (!document) {
      throw new NotFoundException(`Document ${filename} not found`);
    }

    const startTime = Date.now();

    // Download file from storage
    const downloadUrl = await this.fileService.getDownloadUrl(userId, filename);
    const response = await fetch(downloadUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Determine MIME type from extension
    const mimeType = this.getMimeType(filename);

    // Extract text using appropriate method
    const extractedText = await this.extractTextFromBuffer(buffer, mimeType);

    // Calculate content hash for deduplication
    const contentHash = this.hashText(extractedText.text);

    // Update document with extracted text
    await this.db.document.update({
      where: { id: document.id },
      data: {
        extractedText: extractedText.text,
        contentHash,
        ocrConfidence: extractedText.confidence,
        ocrProvider: extractedText.provider,
      },
    });

    this.logger.log(
      `Extracted ${extractedText.text.length} chars from ${filename} (${extractedText.confidence.toFixed(1)}% confidence)`,
    );

    return {
      text: extractedText.text,
      confidence: extractedText.confidence,
      provider: extractedText.provider,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Extract text from base64 encoded data
   * Routes to appropriate extractor based on MIME type
   */
  async extractTextFromBase64(
    userId: string,
    data: string,
    mimeType: string,
  ): Promise<ExtractTextResult> {
    this.logger.log(
      `Extracting text from base64 ${mimeType} for user ${userId}`,
    );

    const startTime = Date.now();
    const buffer = Buffer.from(data, 'base64');

    const result = await this.extractTextFromBuffer(buffer, mimeType);

    return {
      text: result.text,
      confidence: result.confidence,
      provider: result.provider,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Extract text from buffer based on MIME type
   * Routes to: OCR for images, PDF parser for PDFs, direct read for text
   */
  private async extractTextFromBuffer(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ text: string; confidence: number; provider: string }> {
    if (mimeType.startsWith('image/')) {
      // Use OCR for images
      const result = await this.ocrService.extractFromBuffer(buffer, mimeType);
      return {
        text: result.text,
        confidence: result.confidence,
        provider: result.provider,
      };
    } else if (mimeType === 'application/pdf') {
      // Use extraction provider for PDFs
      const text = await this.extractionProvider.extractPdfText(buffer);
      return {
        text,
        confidence: 100, // PDF extraction is deterministic
        provider: 'pdf-parse',
      };
    } else if (mimeType.startsWith('text/')) {
      // Direct text read
      return {
        text: buffer.toString('utf-8'),
        confidence: 100,
        provider: 'direct',
      };
    }

    throw new BadRequestException(`Unsupported MIME type: ${mimeType}`);
  }

  /**
   * Get MIME type from filename extension
   */
  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      bmp: 'image/bmp',
      gif: 'image/gif',
      tiff: 'image/tiff',
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Generate SHA-256 hash of normalized text for deduplication
   */
  private hashText(text: string): string {
    const normalized = text.toLowerCase().replaceAll(/\s+/g, ' ').trim();
    return createHash('sha256').update(normalized).digest('hex');
  }
}
