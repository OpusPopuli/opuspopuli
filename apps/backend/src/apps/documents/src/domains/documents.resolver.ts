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
  PetitionMapResult,
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
import { PaginationArgs } from 'src/common/dto/pagination.args';

import { FileService } from './services/file.service';
import { ScanService } from './services/scan.service';
import { AnalysisService } from './services/analysis.service';
import { LocationService } from './services/location.service';
import { LinkingService } from './services/linking.service';
import { AbuseReportService } from './services/abuse-report.service';
import { ActivityFeedService } from './services/activity-feed.service';
import { ScanHistoryService } from './services/scan-history.service';

/**
 * Documents Resolver
 *
 * Handles document metadata and file storage operations.
 * Supports text extraction from images (OCR), PDFs, and text files.
 * Filename inputs are validated to prevent path traversal attacks.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/463
 */
@Resolver(() => File)
export class DocumentsResolver {
  constructor(
    private readonly fileService: FileService,
    private readonly scanService: ScanService,
    private readonly analysisService: AnalysisService,
    private readonly locationService: LocationService,
    private readonly linkingService: LinkingService,
    private readonly abuseReportService: AbuseReportService,
    private readonly activityFeedService: ActivityFeedService,
    private readonly scanHistoryService: ScanHistoryService,
  ) {}

  @Query(() => [File])
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 15 }) // List operation
  listFiles(@Context() context: GqlContext): Promise<File[]> {
    const user = getUserFromContext(context);
    return this.fileService.listFiles(user.id);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Create, subject: 'File' })
  getUploadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.fileService.getUploadUrl(user.id, input.filename);
  }

  @Query(() => String)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  getDownloadUrl(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<string> {
    const user = getUserFromContext(context);
    return this.fileService.getDownloadUrl(user.id, input.filename);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Delete, subject: 'File' })
  async deleteFile(
    @Args('input') input: FilenameInput,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    return this.fileService.deleteFile(user.id, input.filename);
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
    return this.scanService.processScan(
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
    return this.scanService.extractTextFromFile(user.id, input.filename);
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
    return this.scanService.extractTextFromBase64(
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
    return this.analysisService.analyzeDocument(
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
    return this.analysisService.getDocumentAnalysis(user.id, documentId);
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
    return this.locationService.setDocumentLocation(
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
    return this.locationService.getDocumentLocation(user.id, documentId);
  }

  /**
   * Get petition locations for map display
   * Returns fuzzed coordinates for all documents with scan locations
   */
  @Query(() => PetitionMapResult)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 25 })
  async petitionMapLocations(
    @Args('filters', { nullable: true }) filters?: MapFiltersInput,
  ): Promise<PetitionMapResult> {
    return this.locationService.getPetitionMapLocations(filters);
  }

  /**
   * Get aggregated stats for the petition map sidebar
   */
  @Query(() => PetitionMapStats)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  async petitionMapStats(): Promise<PetitionMapStats> {
    return this.locationService.getPetitionMapStats();
  }

  /**
   * Get real-time petition activity feed (aggregated, privacy-preserving)
   */
  @Query(() => PetitionActivityFeed)
  @UseGuards(AuthGuard)
  @Permissions({ action: Action.Read, subject: 'File' })
  @Extensions({ complexity: 30 })
  async petitionActivityFeed(): Promise<PetitionActivityFeed> {
    return this.activityFeedService.getPetitionActivityFeed();
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
    return this.abuseReportService.submitAbuseReport(
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
    @Args() { skip, take }: PaginationArgs,
    @Args('filters', { nullable: true }) filters?: ScanHistoryFiltersInput,
    @Context() context?: GqlContext,
  ): Promise<PaginatedScanHistory> {
    const user = getUserFromContext(context!);
    return this.scanHistoryService.getScanHistory(user.id, skip, take, filters);
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
    return this.scanHistoryService.getScanDetail(user.id, documentId);
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
    return this.scanHistoryService.softDeleteDocument(user.id, documentId);
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
    const deletedCount = await this.scanHistoryService.deleteAllUserScans(
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
    return this.linkingService.getLinkedPropositions(documentId);
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
    return this.linkingService.getLinkedPetitionDocuments(propositionId);
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
    return this.linkingService.searchPropositions(query);
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
    return this.linkingService.linkDocumentToProposition(
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
    return this.linkingService.unlinkDocumentFromProposition(
      user.id,
      input.documentId,
      input.propositionId,
    );
  }
}
