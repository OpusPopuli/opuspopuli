/**
 * Region Domain Service (thin facade)
 *
 * All sync logic lives in RegionSyncService; all query logic lives in
 * RegionQueryService. This class delegates every public method to the
 * appropriate focused service so the rest of the codebase (resolvers,
 * scheduler, worker, specs) can keep importing from this path unchanged.
 *
 * Module-level type aliases and utility functions remain here for
 * backward-compat — other files import them from this module.
 *
 * Issue DEBT-030.
 */
import { Injectable } from '@nestjs/common';
import { DataType, SyncResult } from '@opuspopuli/region-provider';
import type { DataSourceConfig } from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { CivicsBlockModel } from './models/region-info.model';
import { RegionInfoModel } from './models/region-info.model';
import {
  PaginatedPropositions,
  PropositionModel,
  PropositionStatusGQL,
} from './models/proposition.model';
import { PaginatedMeetings } from './models/meeting.model';
import { PaginatedRepresentatives } from './models/representative.model';
import {
  PropositionAnalysisClaimModel,
  PropositionAnalysisSectionModel,
} from './models/proposition-analysis.model';
import { PaginatedCommittees } from './models/committee.model';
import { PaginatedContributions } from './models/contribution.model';
import { PaginatedExpenditures } from './models/expenditure.model';
import { PaginatedIndependentExpenditures } from './models/independent-expenditure.model';
import {
  BillModel,
  PaginatedBillsModel,
  BillLifecycle,
} from './models/bill.model';
import type { PropositionFunding } from './proposition-funding.service';
import type {
  LegislativeCommitteeDetail,
  PaginatedLegislativeCommittees as PaginatedLegislativeCommitteesShape,
} from './legislative-committee.service';
import { RegionSyncService } from './region-sync.service';
import { RegionQueryService } from './region-query.service';

// ─── Module-level type aliases preserved for backward compatibility ───────────

/** Minimal externalId record used by upsert helpers. */
export type ExternalIdRecord = { externalId: string };

/** Compiled lifecycle stage pattern used for bill status resolution. */
export interface StagePattern {
  stageId: string;
  regex: RegExp;
}

/** Region plugin row shape returned by list/lookup queries. */
export type RegionPluginRow = {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  enabled: boolean;
  parentRegionId?: string;
  fipsCode?: string;
  /**
   * Number of descendant plugins also updated by a cascade toggle
   * (`setRegionPluginEnabled(..., cascade)`). Present only on the row
   * returned by a cascade mutation; undefined on plain list/lookup rows.
   */
  cascadedCount?: number;
};

export function toRegionPluginRow(r: {
  name: string;
  displayName: string;
  description: string | null;
  version: string;
  enabled: boolean;
  parentRegionId: string | null;
  fipsCode: string | null;
}): RegionPluginRow {
  return {
    name: r.name,
    displayName: r.displayName,
    description: r.description ?? undefined,
    version: r.version,
    enabled: r.enabled,
    parentRegionId: r.parentRegionId ?? undefined,
    fipsCode: r.fipsCode ?? undefined,
  };
}

/**
 * Extract the trailing numeric segment from an externalId
 * (e.g., `ca-assembly-02` → `"2"`).
 */
export function deriveDistrictFromExternalId(
  externalId: string,
): string | undefined {
  const last = externalId.split('-').at(-1);
  if (!last || !/^\d+$/.test(last)) return undefined;
  return String(Number.parseInt(last, 10));
}

/**
 * Strip leading zeros from a representative externalId's trailing numeric
 * segment (e.g., `ca-assembly-01` → `ca-assembly-1`).
 */
export function stripLeadingZerosFromExternalId(externalId: string): string {
  if (!externalId) return externalId;
  const parts = externalId.split('-');
  const last = parts.at(-1);
  if (!last || !/^\d+$/.test(last)) return externalId;
  const normalized = String(Number.parseInt(last, 10));
  if (normalized === last) return externalId;
  return [...parts.slice(0, -1), normalized].join('-');
}

const DEFAULT_BIO_NOISE_PATTERNS: RegExp[] = [/^Home\b/i, /Latest News/i];

/**
 * Decide whether a scraped bio string is real content vs junk.
 * Pass plugin-configured noise patterns to override the defaults.
 */
export function isLikelyValidBio(
  bio: string | null | undefined,
  noisePatterns: RegExp[] = DEFAULT_BIO_NOISE_PATTERNS,
): boolean {
  if (!bio) return false;
  const trimmed = bio.trim();
  if (trimmed.length < 100) return false;
  const head = trimmed.slice(0, 100);
  for (const pattern of noisePatterns) {
    if (pattern.test(trimmed) || pattern.test(head)) return false;
  }
  return true;
}

export function extractLastName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const suffixPattern = /\b(Jr|Sr|II|III|IV|Esq)\.?$/i;
  if (trimmed.includes(',')) {
    const beforeComma = trimmed.slice(0, trimmed.indexOf(',')).trim();
    return beforeComma.replace(suffixPattern, '').trim();
  }
  const withoutSuffix = trimmed.replace(suffixPattern, '').trim();
  const tokens = withoutSuffix.split(/\s+/);
  return tokens.at(-1) ?? trimmed;
}

export type RepresentativeRecord = {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  district: string;
  party: string | null;
  photoUrl: string | null;
  contactInfo: unknown;
  committees: unknown;
  committeesSummary: string | null;
  bio: string | null;
  bioSource: string | null;
  bioClaims: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type InternalPropositionRecord = {
  id: string;
  externalId: string;
  title: string;
  summary: string;
  fullText: string | null;
  status: string;
  electionDate: Date | null;
  sourceUrl: string | null;
  analysisSummary: string | null;
  keyProvisions: unknown;
  fiscalImpact: string | null;
  yesOutcome: string | null;
  noOutcome: string | null;
  existingVsProposed: unknown;
  analysisSections: unknown;
  analysisClaims: unknown;
  analysisSource: string | null;
  analysisPromptHash: string | null;
  analysisGeneratedAt: Date | null;
  lifecycleStageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Cast a Prisma proposition row into the GraphQL-shaped object.
 */
export function mapPropositionRecord(
  item: InternalPropositionRecord,
): PropositionModel {
  return {
    id: item.id,
    externalId: item.externalId,
    title: item.title,
    summary: item.summary,
    fullText: item.fullText ?? undefined,
    status: item.status as unknown as PropositionStatusGQL,
    electionDate: item.electionDate ?? undefined,
    sourceUrl: item.sourceUrl ?? undefined,
    analysisSummary: item.analysisSummary ?? undefined,
    keyProvisions: Array.isArray(item.keyProvisions)
      ? (item.keyProvisions as string[])
      : undefined,
    fiscalImpact: item.fiscalImpact ?? undefined,
    yesOutcome: item.yesOutcome ?? undefined,
    noOutcome: item.noOutcome ?? undefined,
    existingVsProposed:
      item.existingVsProposed &&
      typeof item.existingVsProposed === 'object' &&
      'current' in item.existingVsProposed &&
      'proposed' in item.existingVsProposed
        ? (item.existingVsProposed as { current: string; proposed: string })
        : undefined,
    analysisSections: Array.isArray(item.analysisSections)
      ? (item.analysisSections as PropositionAnalysisSectionModel[])
      : undefined,
    analysisClaims: Array.isArray(item.analysisClaims)
      ? (item.analysisClaims as PropositionAnalysisClaimModel[])
      : undefined,
    analysisSource: item.analysisSource ?? undefined,
    analysisGeneratedAt: item.analysisGeneratedAt ?? undefined,
    lifecycleStageId: item.lifecycleStageId ?? undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ─── Facade ───────────────────────────────────────────────────────────────────

/**
 * RegionDomainService — thin facade that delegates to RegionSyncService and
 * RegionQueryService. Preserves the public API surface so resolvers, workers,
 * and specs need no changes.
 */
@Injectable()
export class RegionDomainService {
  constructor(
    private readonly syncService: RegionSyncService,
    private readonly queryService: RegionQueryService,
  ) {}

  // ─── Lifecycle (delegated) ────────────────────────────────────────────────
  // Plugin lifecycle moved to RegionPluginService (#828 Step 6); Nest
  // initializes it directly via its own OnModuleInit, so RegionDomainService
  // no longer needs to forward onModuleInit through syncService.

  async onModuleDestroy(): Promise<void> {
    return this.syncService.onModuleDestroy();
  }

  // ─── Sync / admin delegation ──────────────────────────────────────────────

  syncAll(
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    depth?: string,
    scopedRegionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    return this.syncService.syncAll(
      dataTypes,
      maxReps,
      maxBills,
      depth,
      scopedRegionId,
      pipelineJobId,
      forceStatusRecheck,
    );
  }

  syncDataType(dataType: DataType): Promise<SyncResult> {
    return this.syncService.syncDataType(dataType);
  }

  getRegionInfo(): RegionInfoModel {
    return this.syncService.getRegionInfo();
  }

  regeneratePropositionAnalysis(id: string): Promise<boolean> {
    return this.syncService.regeneratePropositionAnalysis(id);
  }

  invalidateManifest(regionId: string, sourceUrl: string): Promise<number> {
    return this.syncService.invalidateManifest(regionId, sourceUrl);
  }

  setRegionPluginEnabled(
    name: string,
    enabled: boolean,
    cascade = false,
  ): Promise<RegionPluginRow> {
    return this.syncService.setRegionPluginEnabled(name, enabled, cascade);
  }

  /**
   * Re-read `region_plugins` and hot-swap the active local plugin. Setup
   * for the admin recovery mutation (#796): if the table was changed out
   * of band (manual SQL, integration tests cleaning up, etc.) the in-
   * memory active region drifts. This forces a re-sync.
   */
  refreshActiveLocalPlugin(): Promise<void> {
    return this.syncService.refreshActiveLocalPlugin();
  }

  listRegionPlugins(): Promise<RegionPluginRow[]> {
    return this.syncService.listRegionPlugins();
  }

  getRegionPluginByFipsCode(fipsCode: string): Promise<RegionPluginRow | null> {
    return this.syncService.getRegionPluginByFipsCode(fipsCode);
  }

  getPluginDataSourceConfigs(): Promise<
    Array<{ regionId: string; sources: DataSourceConfig[] }>
  > {
    return this.syncService.getPluginDataSourceConfigs();
  }

  // ─── Query delegation ─────────────────────────────────────────────────────

  getCivicsData(regionId: string): Promise<CivicsBlockModel | null> {
    return this.queryService.getCivicsData(regionId);
  }

  getPropositions(
    skip?: number,
    take?: number,
  ): Promise<PaginatedPropositions> {
    return this.queryService.getPropositions(skip, take);
  }

  getProposition(id: string) {
    return this.queryService.getProposition(id);
  }

  getPropositionFunding(
    propositionId: string,
  ): Promise<PropositionFunding | null> {
    return this.queryService.getPropositionFunding(propositionId);
  }

  getMeetings(skip?: number, take?: number): Promise<PaginatedMeetings> {
    return this.queryService.getMeetings(skip, take);
  }

  getMeeting(id: string) {
    return this.queryService.getMeeting(id);
  }

  getRepresentatives(
    skip?: number,
    take?: number,
    chamber?: string,
  ): Promise<PaginatedRepresentatives> {
    return this.queryService.getRepresentatives(skip, take, chamber);
  }

  getRepresentative(id: string) {
    return this.queryService.getRepresentative(id);
  }

  getRepresentativesByDistricts(
    congressionalDistrict?: string,
    stateSenatorialDistrict?: string,
    stateAssemblyDistrict?: string,
  ): Promise<RepresentativeRecord[]> {
    return this.queryService.getRepresentativesByDistricts(
      congressionalDistrict,
      stateSenatorialDistrict,
      stateAssemblyDistrict,
    );
  }

  getRepresentativesByCounty(
    countyRegionId: string,
  ): Promise<RepresentativeRecord[]> {
    return this.queryService.getRepresentativesByCounty(countyRegionId);
  }

  getRepresentativeActivityStats(
    representativeId: string,
    sinceDays?: number,
  ): Promise<{
    presentSessionDays: number;
    totalSessionDays: number;
    absenceDays: number;
    amendments: number;
    committeeHearings: number;
    committeeReports: number;
    resolutions: number;
    votes: number;
    speeches: number;
  }> {
    return this.queryService.getRepresentativeActivityStats(
      representativeId,
      sinceDays,
    );
  }

  getRepresentativeActivity(args: {
    representativeId: string;
    actionTypes?: string[];
    includePresenceYes?: boolean;
    skip?: number;
    take?: number;
  }) {
    return this.queryService.getRepresentativeActivity(args);
  }

  getMinutesPassage(actionId: string) {
    return this.queryService.getMinutesPassage(actionId);
  }

  getCommitteeActivityStats(
    committeeId: string,
    sinceDays?: number,
  ): Promise<{
    hearings: number;
    reports: number;
    amendments: number;
    distinctBills: number;
  }> {
    return this.queryService.getCommitteeActivityStats(committeeId, sinceDays);
  }

  getCommitteeActivity(args: {
    committeeId: string;
    actionTypes?: string[];
    skip?: number;
    take?: number;
  }) {
    return this.queryService.getCommitteeActivity(args);
  }

  getBillActivity(args: {
    billId: string;
    actionTypes?: string[];
    skip?: number;
    take?: number;
  }) {
    return this.queryService.getBillActivity(args);
  }

  listLegislativeCommittees(args: {
    skip: number;
    take: number;
    chamber?: string;
    nameFilter?: string;
  }): Promise<PaginatedLegislativeCommitteesShape> {
    return this.queryService.listLegislativeCommittees(args);
  }

  getLegislativeCommittee(
    id: string,
  ): Promise<LegislativeCommitteeDetail | null> {
    return this.queryService.getLegislativeCommittee(id);
  }

  resolveLegislativeCommitteeIds(
    chamber: string,
    committees: ReadonlyArray<{ name?: string | null }>,
  ): Promise<Map<string, string>> {
    return this.queryService.resolveLegislativeCommitteeIds(
      chamber,
      committees,
    );
  }

  getCommittees(
    skip?: number,
    take?: number,
    sourceSystem?: string,
  ): Promise<PaginatedCommittees> {
    return this.queryService.getCommittees(skip, take, sourceSystem);
  }

  getCommittee(id: string) {
    return this.queryService.getCommittee(id);
  }

  getContributions(
    skip?: number,
    take?: number,
    committeeId?: string,
    sourceSystem?: string,
  ): Promise<PaginatedContributions> {
    return this.queryService.getContributions(
      skip,
      take,
      committeeId,
      sourceSystem,
    );
  }

  getContribution(id: string) {
    return this.queryService.getContribution(id);
  }

  getExpenditures(
    skip?: number,
    take?: number,
    committeeId?: string,
    sourceSystem?: string,
  ): Promise<PaginatedExpenditures> {
    return this.queryService.getExpenditures(
      skip,
      take,
      committeeId,
      sourceSystem,
    );
  }

  getExpenditure(id: string) {
    return this.queryService.getExpenditure(id);
  }

  getIndependentExpenditures(
    skip?: number,
    take?: number,
    committeeId?: string,
    supportOrOppose?: string,
    sourceSystem?: string,
  ): Promise<PaginatedIndependentExpenditures> {
    return this.queryService.getIndependentExpenditures(
      skip,
      take,
      committeeId,
      supportOrOppose,
      sourceSystem,
    );
  }

  getIndependentExpenditure(id: string) {
    return this.queryService.getIndependentExpenditure(id);
  }

  getMyCountySupervisors(userId: string): Promise<RepresentativeRecord[]> {
    return this.queryService.getMyCountySupervisors(userId);
  }

  getBills(
    skip: number,
    take: number,
    measureTypeCode?: string,
    sessionYear?: string,
    authorId?: string,
    committeeId?: string,
    coAuthorId?: string,
    lifecycle: BillLifecycle = BillLifecycle.ACTIVE,
  ): Promise<PaginatedBillsModel> {
    return this.queryService.getBills(
      skip,
      take,
      measureTypeCode,
      sessionYear,
      authorId,
      committeeId,
      coAuthorId,
      lifecycle,
    );
  }

  getBill(id: string): Promise<BillModel | null> {
    return this.queryService.getBill(id);
  }

  getJurisdictionsForUser(userId: string): Promise<
    Prisma.UserJurisdictionGetPayload<{
      include: { jurisdiction: { include: { parent: true } } };
    }>[]
  > {
    return this.queryService.getJurisdictionsForUser(userId);
  }
}
