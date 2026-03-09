import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsResolver } from './documents.resolver';
import { StorageModule } from '@opuspopuli/storage-provider';
import { OcrModule } from '@opuspopuli/ocr-provider';
import { ExtractionModule } from '@opuspopuli/extraction-provider';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';

import { DocumentCrudService } from './services/document-crud.service';
import { FileService } from './services/file.service';
import { ScanService } from './services/scan.service';
import { AnalysisService } from './services/analysis.service';
import { LocationService } from './services/location.service';
import { LinkingService } from './services/linking.service';
import { AbuseReportService } from './services/abuse-report.service';
import { ActivityFeedService } from './services/activity-feed.service';
import { ScanHistoryService } from './services/scan-history.service';

// RelationalDbModule is global, no need to import

/**
 * Documents Module
 *
 * Provides document metadata management and file storage operations.
 * Manages documents in PostgreSQL and files in object storage.
 * Supports text extraction from images (OCR) and PDFs.
 * Supports AI analysis with type-specific prompts.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/463
 */
@Module({
  imports: [
    StorageModule,
    OcrModule,
    ExtractionModule,
    LLMModule,
    PromptClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          promptServiceUrl: config.get('PROMPT_SERVICE_URL'),
          promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
          hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
        },
      }),
    }),
  ],
  providers: [
    DocumentsResolver,
    DocumentCrudService,
    FileService,
    ScanService,
    AnalysisService,
    LocationService,
    LinkingService,
    AbuseReportService,
    ActivityFeedService,
    ScanHistoryService,
  ],
  exports: [
    DocumentCrudService,
    FileService,
    ScanService,
    AnalysisService,
    LocationService,
    LinkingService,
    AbuseReportService,
    ActivityFeedService,
    ScanHistoryService,
  ],
})
export class DocumentsModule {}
