import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsResolver } from './documents.resolver';
import { StorageModule } from '@opuspopuli/storage-provider';
import { OcrModule } from '@opuspopuli/ocr-provider';
import { ExtractionModule } from '@opuspopuli/extraction-provider';
import { LLMModule } from '@opuspopuli/llm-provider';
import { EmbeddingsModule } from '@opuspopuli/embeddings-provider';
import {
  PromptClientModule,
  PromptClientService,
} from '@opuspopuli/prompt-client';

import { DocumentCrudService } from './services/document-crud.service';
import { FileService } from './services/file.service';
import { ScanService } from './services/scan.service';
import { AnalysisService } from './services/analysis.service';
import { PersonalizedImpactService } from './services/personalized-impact.service';
import { LocationService } from './services/location.service';
import { LinkingService } from './services/linking.service';
import { AbuseReportService } from './services/abuse-report.service';
import { ActivityFeedService } from './services/activity-feed.service';
import { ScanHistoryService } from './services/scan-history.service';
import { RetrievalService } from './services/retrieval.service';
import { requirePromptServiceUrl } from 'src/common/config/shared-app.config';

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
    // #1074: matches a scanned petition to the filed measure it actually is.
    EmbeddingsModule,
    StorageModule,
    OcrModule,
    ExtractionModule,
    LLMModule,
    PromptClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          promptServiceUrl: requirePromptServiceUrl(config, 'documents'),
          promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
          hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
        },
      }),
    }),
  ],
  providers: [
    /**
     * Supplies the OCR transcription instruction when OCR_PROVIDER=vision
     * (#1050). Lives here rather than in @opuspopuli/ocr-provider so that
     * package gains no dependency on prompt-client — and so the prompt text
     * itself stays where it belongs, in prompt-service.
     *
     * The hash and version travel with the text; ScanService persists them
     * alongside the transcription, because a transcription that cannot name
     * the instruction that produced it is not attributable evidence.
     */
    {
      provide: 'OCR_PROMPT_SUPPLIER',
      inject: [PromptClientService],
      useFactory: (promptClient: PromptClientService) => () =>
        promptClient.getOcrTranscriptionPrompt({ variant: 'general' }),
    },
    DocumentsResolver,
    DocumentCrudService,
    FileService,
    ScanService,
    AnalysisService,
    PersonalizedImpactService,
    LocationService,
    LinkingService,
    AbuseReportService,
    ActivityFeedService,
    ScanHistoryService,
    RetrievalService,
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
