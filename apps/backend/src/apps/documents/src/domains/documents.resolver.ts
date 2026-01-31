import {
  Args,
  Context,
  Extensions,
  Parent,
  Mutation,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { File } from './models/file.model';
import { User } from './models/user.model';
import { DocumentsService } from './documents.service';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { FilenameInput } from './dto/documents.dto';
import {
  ExtractTextFromFileInput,
  ExtractTextFromBase64Input,
  ExtractTextResult,
} from './dto/ocr.dto';
import {
  AnalyzeDocumentInput,
  AnalyzeDocumentResult,
  DocumentAnalysis,
} from './dto/analysis.dto';

/**
 * Documents Resolver
 *
 * Handles document metadata and file storage operations.
 * Supports text extraction from images (OCR), PDFs, and text files.
 * Filename inputs are validated to prevent path traversal attacks.
 */
@Resolver(() => File)
export class DocumentsResolver {
  constructor(private readonly documentsService: DocumentsService) {}

  @Query(() => [File])
  @UseGuards(AuthGuard)
  @Extensions({ complexity: 15 }) // List operation
  listFiles(@Context() context: GqlContext): Promise<File[]> {
    const user = getUserFromContext(context);
    return this.documentsService.listFiles(user.id);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  getUploadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getUploadUrl(user.id, input.filename);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  getDownloadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getDownloadUrl(user.id, input.filename);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async deleteFile(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.documentsService.deleteFile(user.id, input.filename);
  }

  @ResolveField(() => User)
  user(@Parent() file: File): User {
    return { id: file.userId };
  }

  /**
   * Extract text from an uploaded file using OCR or PDF parsing
   */
  @Mutation(() => ExtractTextResult)
  @UseGuards(AuthGuard)
  @Extensions({ complexity: 50 }) // OCR is computationally expensive
  async extractTextFromFile(
    @Args('input') input: ExtractTextFromFileInput,
    @Context() context: GqlContext,
  ): Promise<ExtractTextResult> {
    const user = getUserFromContext(context);
    return this.documentsService.extractTextFromFile(user.id, input.filename);
  }

  /**
   * Extract text from base64 encoded image or document
   */
  @Mutation(() => ExtractTextResult)
  @UseGuards(AuthGuard)
  @Extensions({ complexity: 50 }) // OCR is computationally expensive
  async extractTextFromBase64(
    @Args('input') input: ExtractTextFromBase64Input,
    @Context() context: GqlContext,
  ): Promise<ExtractTextResult> {
    const user = getUserFromContext(context);
    return this.documentsService.extractTextFromBase64(
      user.id,
      input.data,
      input.mimeType,
    );
  }

  /**
   * Analyze a document using LLM with type-specific prompts
   * Results are cached by contentHash + document type
   */
  @Mutation(() => AnalyzeDocumentResult)
  @UseGuards(AuthGuard)
  @Extensions({ complexity: 100 }) // LLM inference is expensive
  async analyzeDocument(
    @Args('input') input: AnalyzeDocumentInput,
    @Context() context: GqlContext,
  ): Promise<AnalyzeDocumentResult> {
    const user = getUserFromContext(context);
    return this.documentsService.analyzeDocument(
      user.id,
      input.documentId,
      input.forceReanalyze ?? false,
    );
  }

  /**
   * Get existing analysis for a document
   */
  @Query(() => DocumentAnalysis, { nullable: true })
  @UseGuards(AuthGuard)
  async getDocumentAnalysis(
    @Args('documentId') documentId: string,
    @Context() context: GqlContext,
  ): Promise<DocumentAnalysis | null> {
    const user = getUserFromContext(context);
    return this.documentsService.getDocumentAnalysis(user.id, documentId);
  }
}
