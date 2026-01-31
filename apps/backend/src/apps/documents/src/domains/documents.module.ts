import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsResolver } from './documents.resolver';
import { StorageModule } from '@qckstrt/storage-provider';
import { OcrModule } from '@qckstrt/ocr-provider';
import { ExtractionModule } from '@qckstrt/extraction-provider';

// RelationalDbModule is global, no need to import

/**
 * Documents Module
 *
 * Provides document metadata management and file storage operations.
 * Manages documents in PostgreSQL and files in S3.
 * Supports text extraction from images (OCR) and PDFs.
 */
@Module({
  imports: [StorageModule, OcrModule, ExtractionModule],
  providers: [DocumentsService, DocumentsResolver],
  exports: [DocumentsService],
})
export class DocumentsModule {}
