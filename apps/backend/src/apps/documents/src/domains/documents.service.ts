import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from '@qckstrt/storage-provider';
import {
  DbService,
  Document as DbDocument,
  Prisma,
} from '@qckstrt/relationaldb-provider';
import { OcrService } from '@qckstrt/ocr-provider';
import { ExtractionProvider } from '@qckstrt/extraction-provider';
import { ILLMProvider } from '@qckstrt/llm-provider';
import { createHash } from 'node:crypto';

import { IFileConfig } from 'src/config';
import { DocumentStatus } from 'src/common/enums/document.status.enum';
import { File } from './models/file.model';
import { ExtractTextResult } from './dto/ocr.dto';
import { DocumentAnalysis, AnalyzeDocumentResult } from './dto/analysis.dto';
import {
  GeoLocation,
  SetDocumentLocationResult,
  fuzzLocation,
} from './dto/location.dto';
import {
  buildAnalysisPrompt,
  parseAnalysisResponse,
} from './prompts/document-analysis.prompt';

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
    private readonly db: DbService,
    @Inject('STORAGE_PROVIDER') private storage: IStorageProvider,
    @Inject('LLM_PROVIDER') private readonly llm: ILLMProvider,
    private configService: ConfigService,
    private readonly ocrService: OcrService,
    private readonly extractionProvider: ExtractionProvider,
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
    const documents = await this.db.document.findMany({
      where: { userId },
    });

    const files: File[] = documents.map((document) => ({
      userId,
      filename: document.key,
      size: document.size,
      // Cast database enum to application enum - values are compatible at runtime
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
        await this.db.document.deleteMany({
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
    const downloadUrl = await this.getDownloadUrl(userId, filename);
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

  /**
   * Analyze a document using LLM with type-specific prompts
   * Results are cached by contentHash + document type
   */
  async analyzeDocument(
    userId: string,
    documentId: string,
    forceReanalyze = false,
  ): Promise<AnalyzeDocumentResult> {
    const startTime = Date.now();

    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (!document.extractedText) {
      throw new BadRequestException(
        'Document text not extracted. Extract text first.',
      );
    }

    // Check cache by contentHash (same content + type = same analysis)
    if (!forceReanalyze && document.contentHash) {
      const cached = await this.db.document.findFirst({
        where: {
          contentHash: document.contentHash,
          type: document.type,
          analysis: { not: Prisma.DbNull },
        },
        select: { id: true, analysis: true },
      });

      if (cached?.analysis) {
        this.logger.log(
          `Cache hit for document ${documentId} (matched ${cached.id})`,
        );
        return {
          analysis: {
            ...(cached.analysis as object),
            cachedFrom: cached.id,
          } as DocumentAnalysis,
          fromCache: true,
        };
      }
    }

    // Update status to in-progress
    await this.db.document.update({
      where: { id: documentId },
      data: { status: 'ai_analysis_started' },
    });

    try {
      const prompt = buildAnalysisPrompt(document.extractedText, document.type);
      const result = await this.llm.generate(prompt, {
        maxTokens: 1500,
        temperature: 0.3,
      });

      const parsed = parseAnalysisResponse(result.text);
      const processingTimeMs = Date.now() - startTime;

      const analysis = {
        ...parsed,
        documentType: document.type,
        analyzedAt: new Date().toISOString(),
        provider: this.llm.getName(),
        model: this.llm.getModelName(),
        tokensUsed: result.tokensUsed,
        processingTimeMs,
      };

      await this.db.document.update({
        where: { id: documentId },
        data: {
          analysis: analysis as Prisma.InputJsonValue,
          status: 'ai_analysis_complete',
        },
      });

      this.logger.log(
        `Analyzed document ${documentId} (${document.type}) in ${processingTimeMs}ms`,
      );

      return {
        analysis: analysis as unknown as DocumentAnalysis,
        fromCache: false,
      };
    } catch (error) {
      this.logger.error(`Analysis failed for document ${documentId}:`, error);
      await this.db.document.update({
        where: { id: documentId },
        data: { status: 'ai_analysis_failed' },
      });
      throw error;
    }
  }

  /**
   * Get existing analysis for a document
   */
  async getDocumentAnalysis(
    userId: string,
    documentId: string,
  ): Promise<DocumentAnalysis | null> {
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
      select: { analysis: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return (document.analysis as unknown as DocumentAnalysis) || null;
  }

  /**
   * Set privacy-preserving scan location for a document
   *
   * Fuzzes coordinates to ~100m accuracy before storage.
   * See issues #290, #296 for privacy design.
   */
  async setDocumentLocation(
    userId: string,
    documentId: string,
    latitude: number,
    longitude: number,
  ): Promise<SetDocumentLocationResult> {
    // Verify document ownership
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Fuzz location for privacy (~100m accuracy)
    const fuzzedLocation = fuzzLocation(latitude, longitude);

    // Use raw SQL to set PostGIS geography point
    // PostGIS uses POINT(longitude latitude) format
    // Note: Cast column to text (not param to uuid) because Prisma passes params as text
    await this.db.$executeRaw`
      UPDATE documents
      SET scan_location = ST_SetSRID(ST_MakePoint(${fuzzedLocation.longitude}, ${fuzzedLocation.latitude}), 4326)::geography
      WHERE id::text = ${documentId}
    `;

    this.logger.log(
      `Set scan location for document ${documentId} (fuzzed to ~100m)`,
    );

    return {
      success: true,
      fuzzedLocation,
    };
  }

  /**
   * Get scan location for a document
   */
  async getDocumentLocation(
    userId: string,
    documentId: string,
  ): Promise<GeoLocation | null> {
    // Verify document ownership
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Use raw SQL to extract coordinates from PostGIS geography
    // Note: Cast column to text (not param to uuid) because Prisma passes params as text
    const result = await this.db.$queryRaw<
      Array<{ latitude: number; longitude: number }>
    >`
      SELECT
        ST_Y(scan_location::geometry) as latitude,
        ST_X(scan_location::geometry) as longitude
      FROM documents
      WHERE id::text = ${documentId} AND scan_location IS NOT NULL
    `;

    if (result.length === 0) {
      return null;
    }

    return {
      latitude: result[0].latitude,
      longitude: result[0].longitude,
    };
  }

  /**
   * Find documents scanned near a location
   *
   * Returns documents within the specified radius (in meters)
   * that match the given content hash (same petition/document).
   */
  async findDocumentsNearLocation(
    contentHash: string,
    latitude: number,
    longitude: number,
    radiusMeters: number = 10000, // Default 10km
  ): Promise<Array<{ documentId: string; distanceMeters: number }>> {
    const results = await this.db.$queryRaw<
      Array<{ id: string; distance_meters: number }>
    >`
      SELECT
        id,
        ST_Distance(
          scan_location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        ) as distance_meters
      FROM documents
      WHERE
        content_hash = ${contentHash}
        AND scan_location IS NOT NULL
        AND ST_DWithin(
          scan_location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY distance_meters ASC
    `;

    return results.map((r) => ({
      documentId: r.id,
      distanceMeters: r.distance_meters,
    }));
  }
}
