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
import { Permissions } from 'src/common/decorators/permissions.decorator';
import { Action } from 'src/common/enums/action.enum';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { PetitionActivityFeed } from './dto/activity-feed.dto';
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
import {
  GeoLocation,
  SetDocumentLocationInput,
  SetDocumentLocationResult,
  PetitionMapMarker,
  PetitionMapStats,
  MapFiltersInput,
} from './dto/location.dto';
import { ProcessScanInput, ProcessScanResult } from './dto/scan.dto';
import {
  SubmitAbuseReportInput,
  SubmitAbuseReportResult,
} from './dto/abuse-report.dto';
import {
  LinkedProposition,
  LinkedPetitionDocument,
  PropositionSearchResult,
  LinkDocumentToPropositionInput,
  UnlinkDocumentFromPropositionInput,
  LinkDocumentResult,
} from './dto/document-proposition.dto';
import {
  PaginatedScanHistory,
  ScanDetailResult,
  ScanHistoryFiltersInput,
  DeleteAllScansResult,
} from './dto/scan-history.dto';
import { Public } from 'src/common/decorators/public.decorator';

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
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 15 }) // List operation
  listFiles(@Context() context: GqlContext): Promise<File[]> {
    const user = getUserFromContext(context);
    return this.documentsService.listFiles(user.id);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Create, subject: 'File' })
  getUploadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getUploadUrl(user.id, input.filename);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  getDownloadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.documentsService.getDownloadUrl(user.id, input.filename);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Delete, subject: 'File' })
  async deleteFile(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.documentsService.deleteFile(user.id, input.filename);
  }

  /**
   * Process a camera scan: create document, store file, extract text via OCR
   * Bridges the gap between camera capture and the analyzeDocument pipeline
   */
  @Mutation(() => ProcessScanResult)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Create, subject: 'File' })
  @Extensions({ complexity: 75 }) // Storage upload + OCR
  async processScan(
    @Args('input') input: ProcessScanInput,
    @Context() context: GqlContext,
  ): Promise<ProcessScanResult> {
    const user = getUserFromContext(context);
    return this.documentsService.processScan(
      user.id,
      input.data,
      input.mimeType,
      input.documentType,
    );
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
  @Permissions({ action: Action.Update, subject: 'File' })
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
  @Permissions({ action: Action.Update, subject: 'File' })
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
  @Permissions({ action: Action.Update, subject: 'File' })
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
  @Permissions({ action: Action.Read, subject: 'File' })
  async getDocumentAnalysis(
    @Args('documentId') documentId: string,
    @Context() context: GqlContext,
  ): Promise<DocumentAnalysis | null> {
    const user = getUserFromContext(context);
    return this.documentsService.getDocumentAnalysis(user.id, documentId);
  }

  /**
   * Set privacy-preserving scan location for a document
   * Coordinates are fuzzed to ~100m accuracy before storage
   */
  @Mutation(() => SetDocumentLocationResult)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Update, subject: 'File' })
  async setDocumentLocation(
    @Args('input') input: SetDocumentLocationInput,
    @Context() context: GqlContext,
  ): Promise<SetDocumentLocationResult> {
    const user = getUserFromContext(context);
    return this.documentsService.setDocumentLocation(
      user.id,
      input.documentId,
      input.location.latitude,
      input.location.longitude,
    );
  }

  /**
   * Get scan location for a document
   */
  @Query(() => GeoLocation, { nullable: true })
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  async getDocumentLocation(
    @Args('documentId') documentId: string,
    @Context() context: GqlContext,
  ): Promise<GeoLocation | null> {
    const user = getUserFromContext(context);
    return this.documentsService.getDocumentLocation(user.id, documentId);
  }

  /**
   * Get petition locations for map display
   * Returns fuzzed coordinates for all documents with scan locations
   */
  @Query(() => [PetitionMapMarker])
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 25 })
  async petitionMapLocations(
    @Args('filters', { nullable: true }) filters?: MapFiltersInput,
  ): Promise<PetitionMapMarker[]> {
    return this.documentsService.getPetitionMapLocations(filters);
  }

  /**
   * Get aggregated stats for the petition map sidebar
   */
  @Query(() => PetitionMapStats)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  async petitionMapStats(): Promise<PetitionMapStats> {
    return this.documentsService.getPetitionMapStats();
  }

  /**
   * Get real-time petition activity feed (aggregated, privacy-preserving)
   */
  @Query(() => PetitionActivityFeed)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 30 })
  async petitionActivityFeed(): Promise<PetitionActivityFeed> {
    return this.documentsService.getPetitionActivityFeed();
  }

  /**
   * Submit an abuse report for incorrect or problematic scan results
   */
  @Mutation(() => SubmitAbuseReportResult)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Create, subject: 'File' })
  async submitAbuseReport(
    @Args('input') input: SubmitAbuseReportInput,
    @Context() context: GqlContext,
  ): Promise<SubmitAbuseReportResult> {
    const user = getUserFromContext(context);
    return this.documentsService.submitAbuseReport(
      user.id,
      input.documentId,
      input.reason,
      input.description,
    );
  }

  // ============================================
  // SCAN HISTORY
  // ============================================

  /**
   * Get paginated scan history for the authenticated user
   */
  @Query(() => PaginatedScanHistory)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 20 })
  async myScanHistory(
    @Args('skip', { type: () => Number, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Number, defaultValue: 10 }) take: number,
    @Args('filters', { nullable: true }) filters?: ScanHistoryFiltersInput,
    @Context() context?: GqlContext,
  ): Promise<PaginatedScanHistory> {
    const user = getUserFromContext(context!);
    return this.documentsService.getScanHistory(user.id, skip, take, filters);
  }

  /**
   * Get detailed scan result for a single document
   */
  @Query(() => ScanDetailResult, { nullable: true })
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  async scanDetail(
    @Args('documentId') documentId: string,
    @Context() context: GqlContext,
  ): Promise<ScanDetailResult> {
    const user = getUserFromContext(context);
    return this.documentsService.getScanDetail(user.id, documentId);
  }

  /**
   * Soft-delete a single scan
   */
  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Delete, subject: 'File' })
  async softDeleteScan(
    @Args('documentId') documentId: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.documentsService.softDeleteDocument(user.id, documentId);
  }

  /**
   * Soft-delete all scans for the authenticated user
   */
  @Mutation(() => DeleteAllScansResult)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Delete, subject: 'File' })
  async deleteAllMyScans(
    @Context() context: GqlContext,
  ): Promise<DeleteAllScansResult> {
    const user = getUserFromContext(context);
    const deletedCount = await this.documentsService.deleteAllUserScans(
      user.id,
    );
    return { deletedCount };
  }

  // ============================================
  // PETITION-BALLOT LINKING
  // ============================================

  /**
   * Get propositions linked to a document
   */
  @Query(() => [LinkedProposition])
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  async linkedPropositions(
    @Args('documentId') documentId: string,
  ): Promise<LinkedProposition[]> {
    return this.documentsService.getLinkedPropositions(documentId);
  }

  /**
   * Get petition documents linked to a proposition (public, for proposition detail page)
   */
  @Query(() => [LinkedPetitionDocument])
  @Public()
  @Extensions({ complexity: 15 })
  async petitionDocumentsForProposition(
    @Args('propositionId') propositionId: string,
  ): Promise<LinkedPetitionDocument[]> {
    return this.documentsService.getLinkedPetitionDocuments(propositionId);
  }

  /**
   * Search propositions by title (for "Track on Ballot" UI)
   */
  @Query(() => [PropositionSearchResult])
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  async searchPropositions(
    @Args('query') query: string,
  ): Promise<PropositionSearchResult[]> {
    return this.documentsService.searchPropositions(query);
  }

  /**
   * Link a document to a proposition (manual "Track on Ballot")
   */
  @Mutation(() => LinkDocumentResult)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Update, subject: 'File' })
  async linkDocumentToProposition(
    @Args('input') input: LinkDocumentToPropositionInput,
    @Context() context: GqlContext,
  ): Promise<LinkDocumentResult> {
    const user = getUserFromContext(context);
    return this.documentsService.linkDocumentToProposition(
      user.id,
      input.documentId,
      input.propositionId,
    );
  }

  /**
   * Unlink a document from a proposition
   */
  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Update, subject: 'File' })
  async unlinkDocumentFromProposition(
    @Args('input') input: UnlinkDocumentFromPropositionInput,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.documentsService.unlinkDocumentFromProposition(
      user.id,
      input.documentId,
      input.propositionId,
    );
  }
}
