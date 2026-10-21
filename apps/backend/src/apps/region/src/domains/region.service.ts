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
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataType, SyncResult } from '@opuspopuli/region-provider';
import type {
  ArchiveIngestOptions,
  DataSourceConfig,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import {
  AmendmentSupersessionService,
  type SupersessionResult,
} from './amendment-supersession.service';
import {
  FilingReconciliationService,
  type ReconciliationSummary,
} from './filing-reconciliation.service';
import { CivicsBlockModel } from './models/region-info.model';
import { RegionInfoModel } from './models/region-info.model';
import {
  PaginatedPropositions,
  PropositionModel,
  PropositionStatusGQL,
} from './models/proposition.model';
import {
  PaginatedRegionSearchModel,
  SearchResultType,
} from './models/region-search.model';
import { PaginatedMeetings } from './models/meeting.model';
import { MinutesModel, PaginatedMinutes } from './models/minutes.model';
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
import type { RepresentativeFunding } from './representative-funding.service';
import type {
  LegislativeCommitteeDetail,
  PaginatedLegislativeCommittees as PaginatedLegislativeCommitteesShape,
} from './legislative-committee.service';
import {
  type ClaimBackfillReport,
  ClaimBackfillService,
} from './claim-backfill.service';
import { RegionSyncService } from './region-sync.service';
import {
  type LegislativeActionFeedPage,
  RegionQueryService,
} from './region-query.service';

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

/**
 * Trailing name tokens that are not the surname, compared with punctuation
 * and case removed so "Ph.D.", "PhD" and "ph.d." all match.
 *
 * Generational suffixes were here from the start; the credentials were added
 * after a sync stored `last_name = 'M.D.'` for Akilah Weber Pierson and
 * `'Ph.D.'` for Steven S. Choi. That is not only cosmetic: the committee
 * summary generator selects `orderBy: { lastName: 'asc' }`, so a credential
 * in that column sorts the rep under "M", and `trimLeadingName` anchors on
 * the surname and so could not recognise the name heading on their pages.
 */
const NAME_SUFFIXES = new Set([
  'JR',
  'SR',
  'II',
  'III',
  'IV',
  'ESQ',
  'PHD',
  'EDD',
  'PSYD',
  'DDS',
  'DVM',
  'MPH',
  'MBA',
  'CPA',
]);

/**
 * Suffixes that are also real surnames or words, so only count as suffixes
 * when punctuated.
 *
 * `Do` is a common Vietnamese surname and is live in California civic data —
 * Orange County has had a Supervisor Andrew Do. Treating a bare `Do` as a
 * credential stored `last_name = 'Andrew'`, sorted him under A in the
 * committee generator's `orderBy: { lastName: 'asc' }`, rendered "Andrew is
 * Chair of …", and left `trimLeadingName` anchoring on his given name. `V`,
 * `RN`, `MD` and `JD` collide the same way. Requiring the dot keeps
 * "Pierson M.D." working and leaves "Andrew Do" alone.
 */
const PUNCTUATED_ONLY_SUFFIXES = new Set(['V', 'MD', 'JD', 'RN', 'DO']);

function isNameSuffix(token: string): boolean {
  const bare = token.replaceAll(/[.,]/g, '').toUpperCase();
  if (NAME_SUFFIXES.has(bare)) return true;
  return PUNCTUATED_ONLY_SUFFIXES.has(bare) && /[.]/.test(token);
}

/**
 * The surname from a full name, ignoring generational and credential
 * suffixes.
 *
 * Suffixes are popped in a loop rather than matched once, because a name can
 * carry more than one ("Jane Doe M.D. Ph.D."). If every token turns out to be
 * a suffix the original is returned rather than an empty string — a name made
 * only of suffixes is bad input, and erasing it would hide that.
 */
export function extractLastName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';

  // A comma means one of two different things, and they need opposite
  // handling:
  //
  //   "Ávila Farías, Anamarie"   surname first — EVERYTHING before the comma
  //                              is the surname, and a Spanish double
  //                              surname must not be cut down to its last
  //                              word.
  //   "Akilah Weber Pierson, M.D."  normal order, with the credential set off
  //                              by a comma. Here the pre-comma text is the
  //                              whole name, not the surname.
  //
  // What follows the comma tells them apart: a given name means surname
  // first, and nothing but suffixes means the comma is punctuation.
  const commaAt = trimmed.indexOf(',');
  const afterComma = trimmed
    .slice(commaAt + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const surnameFirst =
    commaAt !== -1 &&
    !(afterComma.length > 0 && afterComma.every(isNameSuffix));

  const surnamePart = surnameFirst
    ? trimmed.slice(0, commaAt)
    : trimmed.replaceAll(',', ' ');

  const tokens = surnamePart.trim().split(/\s+/);
  while (tokens.length > 1 && isNameSuffix(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  const surname = surnameFirst ? tokens.join(' ') : tokens.at(-1);
  if (!surname || isNameSuffix(surname)) return trimmed;
  return surname;
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
  regionPluginName: string | null;
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
    regionPluginName: item.regionPluginName ?? undefined,
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
    private readonly claimBackfill: ClaimBackfillService,
    private readonly amendmentSupersession: AmendmentSupersessionService,
    private readonly filingReconciliation: FilingReconciliationService,
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
    archiveOptions?: ArchiveIngestOptions,
  ): Promise<SyncResult[]> {
    return this.syncService.syncAll(
      dataTypes,
      maxReps,
      maxBills,
      depth,
      scopedRegionId,
      pipelineJobId,
      forceStatusRecheck,
      archiveOptions,
    );
  }

  syncDataType(dataType: DataType): Promise<SyncResult> {
    return this.syncService.syncDataType(dataType);
  }

  getRegionInfo(): RegionInfoModel {
    return this.syncService.getRegionInfo();
  }

  regenerateMinutesSummaries(body?: string, limit?: number): Promise<number> {
    return this.syncService.regenerateMinutesSummaries(body, limit);
  }

  /** Backfill proposition summaries from the stored digest text (#1261). */
  backfillPropositionSummaries(limit?: number): Promise<number> {
    return this.syncService.backfillPropositionSummaries(limit);
  }

  /**
   * Backfill the legacy claim blobs into the evidence graph (#1294).
   *
   * Idempotent — `recordClaims` replaces a subject's claims rather than
   * appending — so a re-run converges rather than duplicating.
   */
  backfillClaims(limit?: number): Promise<ClaimBackfillReport> {
    return this.claimBackfill.backfillAll(limit);
  }

  /**
   * Re-run filing reconciliation on its own (#1000).
   *
   * Set-based and idempotent — one statement over the corpus — so a re-run
   * converges. Reaching it previously meant a ~15h `syncRegionData`, which is
   * why the 2026-08-13 corrective run was hand-written SQL instead.
   *
   * **Precondition: an already-synced, already-linked corpus.** Reconciliation
   * reads `committee_id`, and in the sync chain it deliberately runs last,
   * after supersession has dropped stale amendments and the cover-page linker
   * has stamped attribution. Against a freshly-ingested unlinked corpus it
   * would under-attribute. This is a corrective tool, not a substitute for a
   * sync.
   *
   * `async` deliberately: the guard below must surface as a REJECTION, not a
   * synchronous throw. A method typed `Promise<T>` that throws before
   * returning silently bypasses any caller's `.catch()`, which a test caught
   * here.
   */
  async reconcileFilings(): Promise<ReconciliationSummary> {
    if (!this.filingReconciliation.available) {
      throw new ServiceUnavailableException(
        'Filing reconciliation is unavailable — no database is bound. ' +
          'Refusing to report a zeroed summary, which would be ' +
          'indistinguishable from a reconciled corpus.',
      );
    }

    return this.filingReconciliation.reconcileAll();
  }

  /**
   * Supersede amended filings, then re-reconcile (#1000).
   *
   * The second half is not optional and takes no flag. Supersession is the one
   * step that can invalidate every stored verdict, and #1000 measured what that
   * costs: after it corrected 2M rows underneath `filing_reconciliations`, the
   * table went on serving `OVER_ITEMIZED: 7,140` against a true 515 — a 14x
   * overstatement of a fault condition, with nothing marking it stale.
   *
   * Reconciliation is one statement, so chaining it is close to free next to
   * leaving a known-wrong fault count in a table that reads as authoritative.
   *
   * BOTH halves are checked for availability before either runs. Checking
   * reconciliation lazily — when `reconcileFilings()` is reached — would
   * delete the superseded rows first and only then refuse, leaving exactly the
   * half-done state this method exists to prevent: rows gone, verdicts still
   * describing them. In practice both resolve the same `DbService`, so the
   * case is unreachable today; it is ordered this way because the cost of
   * being wrong about that is a corpus nobody can explain.
   */
  async supersedeAmendments(): Promise<{
    supersession: SupersessionResult;
    reconciliation: ReconciliationSummary;
  }> {
    if (
      !this.amendmentSupersession.available ||
      !this.filingReconciliation.available
    ) {
      throw new ServiceUnavailableException(
        'Amendment supersession is unavailable — no database is bound. ' +
          'Refusing to report zero superseded rows, which would be ' +
          'indistinguishable from a corpus with no amendments.',
      );
    }

    const supersession = await this.amendmentSupersession.supersedeAll();
    const reconciliation = await this.reconcileFilings();

    return { supersession, reconciliation };
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
    search?: string,
    status?: PropositionStatusGQL,
    electionYear?: number,
    regionPluginName?: string,
  ): Promise<PaginatedPropositions> {
    return this.queryService.getPropositions(
      skip,
      take,
      search,
      status,
      electionYear,
      regionPluginName,
    );
  }

  searchRegion(
    query: string,
    type: SearchResultType | undefined,
    skip: number,
    take: number,
  ): Promise<PaginatedRegionSearchModel> {
    return this.queryService.searchRegion(query, type, skip, take);
  }

  getProposition(id: string) {
    return this.queryService.getProposition(id);
  }

  getPropositionFunding(
    propositionId: string,
  ): Promise<PropositionFunding | null> {
    return this.queryService.getPropositionFunding(propositionId);
  }

  getRepresentativeFunding(
    representativeId: string,
  ): Promise<RepresentativeFunding | null> {
    return this.queryService.getRepresentativeFunding(representativeId);
  }

  getMeetings(
    skip?: number,
    take?: number,
    body?: string,
  ): Promise<PaginatedMeetings> {
    return this.queryService.getMeetings(skip, take, body);
  }

  getMinutes(
    skip?: number,
    take?: number,
    body?: string,
  ): Promise<PaginatedMinutes> {
    return this.queryService.getMinutes(skip, take, body);
  }

  getMinutesById(id: string): Promise<MinutesModel | null> {
    return this.queryService.getMinutesById(id);
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
  }): Promise<LegislativeActionFeedPage> {
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
  }): Promise<LegislativeActionFeedPage> {
    return this.queryService.getCommitteeActivity(args);
  }

  getBillActivity(args: {
    billId: string;
    actionTypes?: string[];
    skip?: number;
    take?: number;
  }): Promise<LegislativeActionFeedPage> {
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
    search?: string,
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
      search,
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
