import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { DocumentsResolver } from './documents.resolver';
import { StorageModule } from '@opuspopuli/storage-provider';
import { OcrModule } from '@opuspopuli/ocr-provider';
import { ExtractionModule } from '@opuspopuli/extraction-provider';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';

// RelationalDbModule is global, no need to import

/**
 * Documents Module
 *
 * Provides document metadata management and file storage operations.
 * Manages documents in PostgreSQL and files in object storage.
 * Supports text extraction from images (OCR) and PDFs.
 * Supports AI analysis with type-specific prompts.
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
  providers: [DocumentsService, DocumentsResolver],
  exports: [DocumentsService],
})
export class DocumentsModule {}
