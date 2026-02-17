import { Module } from '@nestjs/common';
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
 * Manages documents in PostgreSQL and files in S3.
 * Supports text extraction from images (OCR) and PDFs.
 * Supports AI analysis with type-specific prompts.
 */
@Module({
  imports: [
    StorageModule,
    OcrModule,
    ExtractionModule,
    LLMModule,
    PromptClientModule,
  ],
  providers: [DocumentsService, DocumentsResolver],
  exports: [DocumentsService],
})
export class DocumentsModule {}
