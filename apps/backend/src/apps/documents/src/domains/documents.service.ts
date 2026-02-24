import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from '@opuspopuli/storage-provider';
import {
  DbService,
  Document as DbDocument,
  DocumentType,
  AbuseReportReason,
  Prisma,
} from '@opuspopuli/relationaldb-provider';
import { OcrService } from '@opuspopuli/ocr-provider';
import { ExtractionProvider } from '@opuspopuli/extraction-provider';
import { ILLMProvider } from '@opuspopuli/llm-provider';
import { createHash } from 'node:crypto';

import { IFileConfig } from 'src/config';
import { DocumentStatus } from 'src/common/enums/document.status.enum';
import { File } from './models/file.model';
import { ExtractTextResult } from './dto/ocr.dto';
import { ProcessScanResult } from './dto/scan.dto';
import { SubmitAbuseReportResult } from './dto/abuse-report.dto';
import { DocumentAnalysis, AnalyzeDocumentResult } from './dto/analysis.dto';
import {
  GeoLocation,
  SetDocumentLocationResult,
  PetitionMapMarker,
  PetitionMapStats,
  MapFiltersInput,
  fuzzLocation,
} from './dto/location.dto';
import { parseAnalysisResponse } from './prompts/document-analysis.prompt';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { MetricsService } from 'src/common/metrics';

/**
 * Documents Service
 *
 * Handles document metadata management and file storage operations.
 * Manages documents in PostgreSQL and files in object storage.
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
    private readonly promptClient: PromptClientService,
    private readonly metricsService: MetricsService,
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
   * Get signed URL for file access
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
      // Delete from storage
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
        this.metricsService.recordAnalysisCacheHit('documents-service');
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
      const { promptText } = await this.promptClient.getDocumentAnalysisPrompt({
        documentType: document.type,
        text: document.extractedText,
      });
      const result = await this.llm.generate(promptText, {
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

      this.metricsService.recordAnalysisCacheMiss('documents-service');
      this.metricsService.recordAnalysis(
        'documents-service',
        document.type,
        'success',
        processingTimeMs / 1000,
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
      this.metricsService.recordAnalysisCacheMiss('documents-service');
      this.metricsService.recordAnalysis(
        'documents-service',
        document.type,
        'failure',
        (Date.now() - startTime) / 1000,
      );
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
   * Get petition locations for map display
   * Returns documents with scan locations, optionally filtered by bounds/type/date
   * Coordinates are already fuzzed at write time, safe to return directly
   */
  async getPetitionMapLocations(
    filters?: MapFiltersInput,
  ): Promise<PetitionMapMarker[]> {
    const conditions: string[] = ['scan_location IS NOT NULL'];
    const params: unknown[] = [];

    if (filters?.bounds) {
      const i = params.length + 1;
      conditions.push(
        `ST_Within(scan_location::geometry, ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326))`,
      );
      params.push(
        filters.bounds.swLng,
        filters.bounds.swLat,
        filters.bounds.neLng,
        filters.bounds.neLat,
      );
    }

    if (filters?.documentType) {
      conditions.push(`type = $${params.length + 1}`);
      params.push(filters.documentType);
    }

    if (filters?.startDate) {
      conditions.push(`created_at >= $${params.length + 1}`);
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      conditions.push(`created_at <= $${params.length + 1}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const results = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        latitude: number;
        longitude: number;
        document_type: string | null;
        created_at: Date;
      }>
    >(
      `SELECT
        id::text as id,
        ST_Y(scan_location::geometry) as latitude,
        ST_X(scan_location::geometry) as longitude,
        type as document_type,
        created_at
      FROM documents
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT 5000`,
      ...params,
    );

    return results.map((r) => ({
      id: r.id,
      latitude: r.latitude,
      longitude: r.longitude,
      documentType: r.document_type ?? undefined,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get aggregated stats for the petition map sidebar
   */
  async getPetitionMapStats(): Promise<PetitionMapStats> {
    const results = await this.db.$queryRaw<
      Array<{
        total_petitions: bigint;
        total_with_location: bigint;
        recent_petitions: bigint;
      }>
    >`
      SELECT
        COUNT(*) as total_petitions,
        COUNT(scan_location) as total_with_location,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as recent_petitions
      FROM documents
    `;

    const stats = results[0];
    return {
      totalPetitions: Number(stats?.total_petitions ?? 0),
      totalWithLocation: Number(stats?.total_with_location ?? 0),
      recentPetitions: Number(stats?.recent_petitions ?? 0),
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
