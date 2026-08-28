import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DbService,
  DocumentStatus,
  DocumentType,
} from '@opuspopuli/relationaldb-provider';
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
  // No STORAGE_PROVIDER injection, deliberately (#1075). This service must
  // never persist a scan image, and the cleanest way to guarantee that is
  // to remove the capability rather than the call site.

  private readonly logger = new Logger(ScanService.name, { timestamp: true });

  constructor(
    private readonly db: DbService,
    private readonly configService: ConfigService,
    private readonly ocrService: OcrService,
    private readonly extractionProvider: ExtractionProvider,
    private readonly metricsService: MetricsService,
    private readonly fileService: FileService,
  ) {
    // Kept as a boot-time assertion only. This service no longer reads the
    // config — camera scans are never stored (#1075) — but `extractTextFromFile`
    // still routes through FileService for uploaded documents, so a missing
    // file config is still a misconfiguration worth failing loudly on.
    if (!configService.get<IFileConfig>('file')) {
      throw new Error('File storage config is missing');
    }
  }

  /**
   * Process a camera scan: create the document record, extract text via OCR,
   * and discard the image.
   *
   * THE IMAGE IS NEVER PERSISTED (#1075). It used to be uploaded to object
   * storage, where it sat indefinitely and was never read back by anything —
   * no resolver returns it, ScanDetailResult exposes no image field, and no
   * frontend surface renders it. A petition photograph can carry five
   * strangers' handwritten names and residence addresses plus a circulator's
   * own address, so that upload was pure liability with no product purpose.
   *
   * Not storing it is the only redaction that cannot partially fail. The
   * client already crops the signature block before upload; this is the second
   * layer, and the two are independent.
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

    // `location` and `key` are retained on the row but no longer address any
    // stored object — nothing is uploaded. They stay because dropping columns
    // is a separate, additive-safe follow-up; the value is a marker, not a
    // path, so nothing can mistake it for something fetchable.
    const document = await this.db.document.create({
      data: {
        location: 'not-stored',
        userId,
        key: `scan-${Date.now()}-${checksum.substring(0, 8)}`,
        size: buffer.length,
        checksum,
        status: 'text_extraction_started',
        type: documentType,
      },
    });

    try {
      // OCR reads the buffer in memory. It is never written anywhere, and goes
      // out of scope when this method returns.
      const extractedText = await this.extractTextFromBuffer(buffer, mimeType);

      // Calculate content hash and persist extracted text
      await this.persistExtractedText(document.id, extractedText, {
        status: DocumentStatus.text_extraction_complete,
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

    // Calculate content hash and persist extracted text
    await this.persistExtractedText(document.id, extractedText);

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
   * Compute content hash and write extracted-text fields to the document row.
   * Pass `status` only when the caller also wants to update the document status
   * (e.g. `processScan` stamps `text_extraction_complete`; `extractTextFromFile`
   * leaves the status column unchanged).
   */
  private async persistExtractedText(
    documentId: string,
    extractedText: { text: string; confidence: number; provider: string },
    extra?: { status?: DocumentStatus },
  ): Promise<void> {
    const contentHash = this.hashText(extractedText.text);
    await this.db.document.update({
      where: { id: documentId },
      data: {
        extractedText: extractedText.text,
        contentHash,
        ocrConfidence: extractedText.confidence,
        ocrProvider: extractedText.provider,
        ...(extra?.status ? { status: extra.status } : {}),
      },
    });
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
