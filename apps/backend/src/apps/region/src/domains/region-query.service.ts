import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';

import { RegionCacheService } from './region-cache.service';
import {
  PropositionFundingService,
  type PropositionFunding,
} from './proposition-funding.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import {
  LegislativeCommitteeService,
  type LegislativeCommitteeDetail,
  type PaginatedLegislativeCommittees as PaginatedLegislativeCommitteesShape,
} from './legislative-committee.service';
import { CivicsBlockModel } from './models/region-info.model';
import {
  PaginatedPropositions,
  PropositionModel,
} from './models/proposition.model';
import { PaginatedMeetings } from './models/meeting.model';
import {
  BioClaimModel,
  CommitteeAssignmentModel,
  ContactInfoModel,
  PaginatedRepresentatives,
} from './models/representative.model';
import { PaginatedCommittees } from './models/committee.model';
import { PaginatedContributions } from './models/contribution.model';
import { PaginatedExpenditures } from './models/expenditure.model';
import { PaginatedIndependentExpenditures } from './models/independent-expenditure.model';
import {
  BillModel,
  BillVoteModel,
  BillCoAuthorModel,
  PaginatedBillsModel,
} from './models/bill.model';

import {
  mapPropositionRecord,
  type RepresentativeRecord,
} from './region.service';

// ─── Local type aliases ───────────────────────────────────────────────────────

type MeetingRecord = {
  id: string;
  externalId: string;
  title: string;
  body: string;
  scheduledAt: Date;
  location: string | null;
  agendaUrl: string | null;
  videoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PropositionRecord = {
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

type CommitteeRecord = {
  id: string;
  externalId: string;
  name: string;
  type: string;
  candidateName: string | null;
  candidateOffice: string | null;
  propositionId: string | null;
  party: string | null;
  status: string;
  sourceSystem: string;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type ContributionRecord = {
  id: string;
  externalId: string;
  committeeId: string;
  donorName: string;
  donorType: string;
  donorEmployer: string | null;
  donorOccupation: string | null;
  donorCity: string | null;
  donorState: string | null;
  donorZip: string | null;
  amount: Prisma.Decimal;
  date: Date;
  electionType: string | null;
  contributionType: string | null;
  sourceSystem: string;
  createdAt: Date;
  updatedAt: Date;
};

type ExpenditureRecord = {
  id: string;
  externalId: string;
  committeeId: string;
  payeeName: string;
  amount: Prisma.Decimal;
  date: Date;
  purposeDescription: string | null;
  expenditureCode: string | null;
  candidateName: string | null;
  propositionTitle: string | null;
  supportOrOppose: string | null;
  sourceSystem: string;
  createdAt: Date;
  updatedAt: Date;
};

type IndependentExpenditureRecord = {
  id: string;
  externalId: string;
  committeeId: string;
  committeeName: string;
  candidateName: string | null;
  propositionTitle: string | null;
  supportOrOppose: string;
  amount: Prisma.Decimal;
  date: Date;
  electionDate: Date | null;
  description: string | null;
  sourceSystem: string;
  createdAt: Date;
  updatedAt: Date;
};

interface LegislativeActionFeedItem {
  id: string;
  externalId: string;
  body: string;
  date: Date;
  actionType: string;
  position: string | null;
  text: string | null;
  passageStart: number | null;
  passageEnd: number | null;
  rawSubject: string | null;
  representativeId: string | null;
  propositionId: string | null;
  committeeId: string | null;
  minutesId: string;
  minutesExternalId: string;
}

interface LegislativeActionFeedPage {
  items: LegislativeActionFeedItem[];
  total: number;
  hasMore: boolean;
}

/**
 * RegionQueryService — owns all read/query methods extracted from the monolithic
 * RegionDomainService (issue DEBT-030). Accepts the same optional injections that
 * the query methods need but nothing more.
 */
@Injectable()
export class RegionQueryService {
  private readonly logger = new Logger(RegionQueryService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    private readonly cacheService: RegionCacheService,
    @Optional() private readonly propositionFunding?: PropositionFundingService,
    @Optional()
    private readonly legislativeCommittees?: LegislativeCommitteeService,
    @Optional()
    private readonly legislativeCommitteeLinker?: LegislativeCommitteeLinkerService,
  ) {}

  // ─── Civics data ──────────────────────────────────────────────────────────────

  async getCivicsData(regionId: string): Promise<CivicsBlockModel | null> {
    const rows = await this.db.civicsBlock.findMany({
      where: { regionId },
      orderBy: { extractedAt: 'desc' },
    });

    if (rows.length === 0) return null;

    const chambers = new Map<string, CivicsBlockModel['chambers'][number]>();
    const measureTypes = new Map<
      string,
      CivicsBlockModel['measureTypes'][number]
    >();
    const lifecycleStages = new Map<
      string,
      CivicsBlockModel['lifecycleStages'][number]
    >();
    const glossary = new Map<string, CivicsBlockModel['glossary'][number]>();
    let sessionScheme: CivicsBlockModel['sessionScheme'] | null = null;

    for (const row of rows) {
      const src = row.sourceUrl;
      this.mergeChambers(
        chambers,
        row.chambers as Record<string, unknown>[] | null,
        src,
      );
      this.mergeMeasureTypes(
        measureTypes,
        row.measureTypes as Record<string, unknown>[] | null,
        src,
      );
      this.mergeLifecycleStages(
        lifecycleStages,
        row.lifecycleStages as Record<string, unknown>[] | null,
        src,
      );
      this.mergeGlossary(
        glossary,
        row.glossary as Record<string, unknown>[] | null,
        src,
      );
      if (!sessionScheme) {
        sessionScheme = this.extractSessionScheme(
          row.sessionScheme as Record<string, unknown> | null,
          src,
        );
      }
    }

    if (
      chambers.size === 0 &&
      measureTypes.size === 0 &&
      lifecycleStages.size === 0 &&
      glossary.size === 0
    ) {
      return null;
    }

    return {
      chambers: Array.from(chambers.values()),
      measureTypes: Array.from(measureTypes.values()),
      lifecycleStages: Array.from(lifecycleStages.values()),
      sessionScheme: sessionScheme ?? undefined,
      glossary: Array.from(glossary.values()),
    };
  }

  private sanitizeCivicsUrl(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
        ? raw
        : undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeCivicText(
    value: unknown,
    fallbackSourceUrl: string,
  ): CivicsBlockModel['glossary'][number]['definition'] {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'verbatim' in value
    ) {
      const v = value as Record<string, unknown>;
      return {
        verbatim: String(v['verbatim'] ?? ''),
        plainLanguage: String(v['plainLanguage'] ?? v['verbatim'] ?? ''),
        sourceUrl: String(v['sourceUrl'] ?? fallbackSourceUrl),
      };
    }
    if (Array.isArray(value)) {
      this.logger.warn(
        `normalizeCivicText received an array value — expected string or CivicText object`,
      );
      return { verbatim: '', plainLanguage: '', sourceUrl: fallbackSourceUrl };
    }
    if (value !== null && value !== undefined && typeof value !== 'string') {
      this.logger.warn(
        `normalizeCivicText received a ${typeof value} value — expected string or CivicText object`,
      );
      return { verbatim: '', plainLanguage: '', sourceUrl: fallbackSourceUrl };
    }
    const text = typeof value === 'string' ? value : '';
    return {
      verbatim: text,
      plainLanguage: text,
      sourceUrl: fallbackSourceUrl,
    };
  }

  private mergeChambers(
    chambers: Map<string, CivicsBlockModel['chambers'][number]>,
    rawC: Record<string, unknown>[] | null,
    src: string,
  ): void {
    if (!rawC) return;
    for (const ch of rawC) {
      const name = String(ch['name'] ?? '');
      if (!name || chambers.has(name)) continue;
      chambers.set(name, {
        name,
        abbreviation: String(ch['abbreviation'] ?? ''),
        size: Number(ch['size'] ?? 0),
        termYears: Number(ch['termYears'] ?? 0),
        leadershipRoles: Array.isArray(ch['leadershipRoles'])
          ? (ch['leadershipRoles'] as string[])
          : [],
        description: this.normalizeCivicText(ch['description'], src),
      });
    }
  }

  private mergeMeasureTypes(
    measureTypes: Map<string, CivicsBlockModel['measureTypes'][number]>,
    rawM: Record<string, unknown>[] | null,
    src: string,
  ): void {
    if (!rawM) return;
    for (const mt of rawM) {
      const code = String(mt['code'] ?? '');
      if (!code || measureTypes.has(code)) continue;
      measureTypes.set(code, {
        code,
        name: String(mt['name'] ?? ''),
        chamber: String(mt['chamber'] ?? ''),
        votingThreshold: String(mt['votingThreshold'] ?? 'majority'),
        reachesGovernor: Boolean(mt['reachesGovernor']),
        purpose: this.normalizeCivicText(mt['purpose'], src),
        lifecycleStageIds: Array.isArray(mt['lifecycleStageIds'])
          ? (mt['lifecycleStageIds'] as string[])
          : [],
      });
    }
  }

  private buildCitizenAction(
    rawAction: Record<string, unknown> | null,
    src: string,
  ): CivicsBlockModel['lifecycleStages'][number]['citizenAction'] {
    if (!rawAction) return undefined;
    return {
      verb: String(rawAction['verb'] ?? 'learn'),
      label: this.normalizeCivicText(rawAction['label'], src),
      url: this.sanitizeCivicsUrl(
        (rawAction['url'] as string | undefined) ??
          (rawAction['sourceUrl'] as string | undefined),
      ),
      urgency: String(rawAction['urgency'] ?? 'passive') as
        | 'active'
        | 'passive'
        | 'none',
    };
  }

  private mergeLifecycleStages(
    lifecycleStages: Map<string, CivicsBlockModel['lifecycleStages'][number]>,
    rawL: Record<string, unknown>[] | null,
    src: string,
  ): void {
    if (!rawL) return;
    for (const ls of rawL) {
      const id = String(ls['id'] ?? '');
      if (!id || lifecycleStages.has(id)) continue;
      const citizenAction = this.buildCitizenAction(
        ls['citizenAction'] as Record<string, unknown> | null,
        src,
      );
      lifecycleStages.set(id, {
        id,
        name: this.normalizeCivicText(ls['name'], src),
        shortDescription: this.normalizeCivicText(ls['shortDescription'], src),
        longDescription: ls['longDescription']
          ? this.normalizeCivicText(ls['longDescription'], src)
          : undefined,
        statusStringPatterns: Array.isArray(ls['statusStringPatterns'])
          ? (ls['statusStringPatterns'] as string[])
          : [],
        citizenAction,
      });
    }
  }

  private mergeGlossary(
    glossary: Map<string, CivicsBlockModel['glossary'][number]>,
    rawG: Record<string, unknown>[] | null,
    src: string,
  ): void {
    if (!rawG) return;
    for (const ge of rawG) {
      const slug = String(ge['slug'] ?? '');
      if (!slug || glossary.has(slug)) continue;
      glossary.set(slug, {
        term: String(ge['term'] ?? ''),
        slug,
        definition: this.normalizeCivicText(ge['definition'], src),
        longDefinition: ge['longDefinition']
          ? this.normalizeCivicText(ge['longDefinition'], src)
          : undefined,
        relatedTerms: Array.isArray(ge['relatedTerms'])
          ? (ge['relatedTerms'] as string[])
          : [],
      });
    }
  }

  private extractSessionScheme(
    rawS: Record<string, unknown> | null,
    src: string,
  ): CivicsBlockModel['sessionScheme'] | null {
    if (!rawS) return null;
    return {
      cadence: String(rawS['cadence'] ?? 'annual'),
      namingPattern: String(rawS['namingPattern'] ?? ''),
      description: this.normalizeCivicText(rawS['description'], src),
    };
  }

  // ─── Propositions ─────────────────────────────────────────────────────────────

  async getPropositions(
    skip: number = 0,
    take: number = 10,
  ): Promise<PaginatedPropositions> {
    return this.cacheService.cachedQuery(
      `propositions:${skip}:${take}`,
      async () => {
        const [items, total] = await Promise.all([
          this.db.proposition.findMany({
            orderBy: [{ electionDate: 'desc' }, { createdAt: 'desc' }],
            skip,
            take: take + 1,
          }),
          this.db.proposition.count(),
        ]);

        const hasMore = items.length > take;
        const paginatedItems = items.slice(0, take);

        return {
          items: paginatedItems.map((item: PropositionRecord) =>
            mapPropositionRecord(item),
          ),
          total,
          hasMore,
        };
      },
    );
  }

  async getProposition(id: string) {
    return this.db.proposition.findUnique({ where: { id } });
  }

  async getPropositionFunding(
    propositionId: string,
  ): Promise<PropositionFunding | null> {
    if (!this.propositionFunding) return null;
    return this.propositionFunding.getFunding(propositionId);
  }

  // ─── Meetings ─────────────────────────────────────────────────────────────────

  async getMeetings(
    skip: number = 0,
    take: number = 10,
  ): Promise<PaginatedMeetings> {
    return this.cacheService.cachedQuery(
      `meetings:${skip}:${take}`,
      async () => {
        const [items, total] = await Promise.all([
          this.db.meeting.findMany({
            orderBy: { scheduledAt: 'desc' },
            skip,
            take: take + 1,
          }),
          this.db.meeting.count(),
        ]);

        const hasMore = items.length > take;
        const paginatedItems = items.slice(0, take);

        return {
          items: paginatedItems.map((item: MeetingRecord) => ({
            ...item,
            location: item.location ?? undefined,
            agendaUrl: item.agendaUrl ?? undefined,
            videoUrl: item.videoUrl ?? undefined,
          })),
          total,
          hasMore,
        };
      },
    );
  }

  async getMeeting(id: string) {
    return this.db.meeting.findUnique({ where: { id } });
  }

  // ─── Representatives ──────────────────────────────────────────────────────────

  async getRepresentatives(
    skip: number = 0,
    take: number = 10,
    chamber?: string,
  ): Promise<PaginatedRepresentatives> {
    return this.cacheService.cachedQuery(
      `representatives:${skip}:${take}:${chamber ?? 'all'}`,
      async () => {
        const where = chamber ? { chamber } : undefined;

        const [items, total] = await Promise.all([
          this.db.representative.findMany({
            where,
            orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
            skip,
            take: take + 1,
          }),
          this.db.representative.count({ where }),
        ]);

        const hasMore = items.length > take;
        const paginatedItems = items.slice(0, take);

        return {
          items: paginatedItems.map((item: RepresentativeRecord) => ({
            ...item,
            party: item.party ?? undefined,
            photoUrl: item.photoUrl ?? undefined,
            contactInfo: (item.contactInfo as ContactInfoModel) ?? undefined,
            committees:
              (item.committees as CommitteeAssignmentModel[]) ?? undefined,
            committeesSummary: item.committeesSummary ?? undefined,
            bio: item.bio ?? undefined,
            bioSource: item.bioSource ?? undefined,
            bioClaims: Array.isArray(item.bioClaims)
              ? (item.bioClaims as unknown as BioClaimModel[])
              : undefined,
          })),
          total,
          hasMore,
        };
      },
    );
  }

  async getRepresentative(id: string) {
    return this.db.representative.findUnique({ where: { id } });
  }

  async getRepresentativesByDistricts(
    congressionalDistrict?: string,
    stateSenatorialDistrict?: string,
    stateAssemblyDistrict?: string,
  ): Promise<RepresentativeRecord[]> {
    const buildConditions = (
      chamber: string,
      raw?: string,
    ): { chamber: string; district: string }[] => {
      if (!raw) return [];
      const padded = this.extractDistrictNumber(raw);
      if (!padded) return [];
      const unpadded = String(Number.parseInt(padded, 10));
      return [
        { chamber, district: padded },
        { chamber, district: unpadded },
      ];
    };

    const conditions = [
      ...buildConditions('Assembly', stateAssemblyDistrict),
      ...buildConditions('Senate', stateSenatorialDistrict),
    ];

    if (conditions.length === 0) return [];

    return this.db.representative.findMany({
      where: {
        OR: conditions.map((c) => ({
          chamber: c.chamber,
          district: c.district,
        })),
      },
      orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
    });
  }

  async getRepresentativesByCounty(
    countyRegionId: string,
  ): Promise<RepresentativeRecord[]> {
    return this.db.representative.findMany({
      where: {
        regionId: countyRegionId,
        chamber: 'Board of Supervisors',
        deletedAt: null,
      },
      orderBy: [{ district: 'asc' }, { lastName: 'asc' }],
    });
  }

  private extractDistrictNumber(districtString: string): string | null {
    const match = districtString.match(/(\d+)/);
    if (!match) return null;
    return match[1].padStart(2, '0');
  }

  // ─── Representative activity (issue #665) ────────────────────────────────────

  async getRepresentativeActivityStats(
    representativeId: string,
    sinceDays: number = 90,
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
    const rep = await this.db.representative.findUnique({
      where: { id: representativeId },
      select: { chamber: true },
    });
    if (!rep) {
      return {
        presentSessionDays: 0,
        totalSessionDays: 0,
        absenceDays: 0,
        amendments: 0,
        committeeHearings: 0,
        committeeReports: 0,
        resolutions: 0,
        votes: 0,
        speeches: 0,
      };
    }

    const since = this.windowSince(sinceDays);
    const repWhere = { representativeId, date: { gte: since } };

    const [counts, presentDays, absenceDays, totalSessionDays] =
      await Promise.all([
        this.actionCountsByType(repWhere),
        this.distinctActionDates({
          ...repWhere,
          actionType: 'presence',
          position: 'yes',
        }),
        this.distinctActionDates({
          ...repWhere,
          actionType: 'presence',
          position: 'absent',
        }),
        this.distinctActionDates({
          body: rep.chamber,
          actionType: 'presence',
          date: { gte: since },
        }),
      ]);

    return {
      presentSessionDays: presentDays,
      totalSessionDays: totalSessionDays,
      absenceDays: absenceDays,
      amendments: counts.get('amendment') ?? 0,
      committeeHearings: counts.get('committee_hearing') ?? 0,
      committeeReports: counts.get('committee_report') ?? 0,
      resolutions: counts.get('resolution') ?? 0,
      votes: counts.get('vote') ?? 0,
      speeches: counts.get('speech') ?? 0,
    };
  }

  async getRepresentativeActivity(args: {
    representativeId: string;
    actionTypes?: string[];
    includePresenceYes?: boolean;
    skip?: number;
    take?: number;
  }): Promise<LegislativeActionFeedPage> {
    const where: Record<string, unknown> = this.buildActionFeedWhere({
      representativeId: args.representativeId,
      actionTypes: args.actionTypes,
    });
    if (!args.includePresenceYes && !args.actionTypes?.includes('presence')) {
      where.NOT = { AND: [{ actionType: 'presence' }, { position: 'yes' }] };
    }
    return this.paginateLegislativeActions(where, args.skip, args.take);
  }

  async getMinutesPassage(actionId: string): Promise<{
    actionId: string;
    minutesExternalId: string;
    body: string;
    date: Date;
    sourceUrl: string;
    passageStart: number;
    passageEnd: number;
    passageText: string;
    sectionContext?: string;
  } | null> {
    const action = await this.db.legislativeAction.findUnique({
      where: { id: actionId },
      include: {
        minutes: {
          select: {
            externalId: true,
            body: true,
            date: true,
            sourceUrl: true,
            rawText: true,
          },
        },
      },
    });
    if (!action || !action.minutes.rawText) return null;
    if (action.passageStart === null || action.passageEnd === null) return null;

    const raw = action.minutes.rawText;
    const PASSAGE_CAP = 1024;
    const CONTEXT_HALF = 500;

    const start = Math.max(0, action.passageStart);
    const cappedEnd = Math.min(raw.length, start + PASSAGE_CAP);
    const end = Math.min(action.passageEnd, cappedEnd);
    const passageText = raw.slice(start, end);

    const ctxStart = this.snapToWhitespace(
      raw,
      Math.max(0, start - CONTEXT_HALF),
      'back',
    );
    const ctxEnd = this.snapToWhitespace(
      raw,
      Math.min(raw.length, end + CONTEXT_HALF),
      'forward',
    );
    const sectionContext = raw.slice(ctxStart, ctxEnd);

    return {
      actionId: action.id,
      minutesExternalId: action.minutes.externalId,
      body: action.minutes.body,
      date: action.minutes.date,
      sourceUrl: action.minutes.sourceUrl,
      passageStart: start,
      passageEnd: end,
      passageText,
      sectionContext:
        sectionContext === passageText ? undefined : sectionContext,
    };
  }

  private snapToWhitespace(
    text: string,
    idx: number,
    direction: 'back' | 'forward',
  ): number {
    if (direction === 'back') {
      const probe = Math.max(0, idx);
      if (probe === 0) return 0;
      for (let i = probe; i > Math.max(0, probe - 50); i--) {
        if (/\s/.test(text[i])) return i + 1;
      }
      return probe;
    }
    const probe = Math.min(text.length, idx);
    if (probe === text.length) return probe;
    for (let i = probe; i < Math.min(text.length, probe + 50); i++) {
      if (/\s/.test(text[i])) return i;
    }
    return probe;
  }

  // ─── Committee activity ───────────────────────────────────────────────────────

  async getCommitteeActivityStats(
    committeeId: string,
    sinceDays: number = 90,
  ): Promise<{
    hearings: number;
    reports: number;
    amendments: number;
    distinctBills: number;
  }> {
    const since = this.windowSince(sinceDays);
    const cmtWhere = { committeeId, date: { gte: since } };

    const [counts, distinctBills] = await Promise.all([
      this.actionCountsByType(cmtWhere),
      this.db.legislativeAction.findMany({
        where: { ...cmtWhere, propositionId: { not: null } },
        distinct: ['propositionId'],
        select: { propositionId: true },
      }),
    ]);

    return {
      hearings: counts.get('committee_hearing') ?? 0,
      reports: counts.get('committee_report') ?? 0,
      amendments: counts.get('amendment') ?? 0,
      distinctBills: distinctBills.length,
    };
  }

  async getCommitteeActivity(args: {
    committeeId: string;
    actionTypes?: string[];
    skip?: number;
    take?: number;
  }): Promise<LegislativeActionFeedPage> {
    const where = this.buildActionFeedWhere({
      committeeId: args.committeeId,
      actionTypes: args.actionTypes,
    });
    return this.paginateLegislativeActions(where, args.skip, args.take);
  }

  // ─── Legislative committee getters ───────────────────────────────────────────

  async listLegislativeCommittees(args: {
    skip: number;
    take: number;
    chamber?: string;
    nameFilter?: string;
  }): Promise<PaginatedLegislativeCommitteesShape> {
    if (!this.legislativeCommittees) {
      return { items: [], total: 0, hasMore: false };
    }
    return this.legislativeCommittees.list(args);
  }

  async getLegislativeCommittee(
    id: string,
  ): Promise<LegislativeCommitteeDetail | null> {
    if (!this.legislativeCommittees) return null;
    return this.legislativeCommittees.getDetail(id);
  }

  async resolveLegislativeCommitteeIds(
    chamber: string,
    committees: ReadonlyArray<{ name?: string | null }>,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!this.legislativeCommitteeLinker) return result;

    const externalIdByName = new Map<string, string>();
    for (const c of committees) {
      const rawName = c?.name?.trim();
      if (!rawName) continue;
      const externalId = this.legislativeCommitteeLinker.externalIdFor(
        chamber,
        rawName,
      );
      if (externalId) externalIdByName.set(rawName, externalId);
    }
    if (externalIdByName.size === 0) return result;

    const rows = await this.db.legislativeCommittee.findMany({
      where: {
        deletedAt: null,
        externalId: { in: Array.from(new Set(externalIdByName.values())) },
      },
      select: { id: true, externalId: true },
    });
    const idByExternalId = new Map(rows.map((r) => [r.externalId, r.id]));
    for (const [rawName, externalId] of externalIdByName) {
      const id = idByExternalId.get(externalId);
      if (id) result.set(rawName, id);
    }
    return result;
  }

  // ─── Campaign finance getters ─────────────────────────────────────────────────

  async getCommittees(
    skip: number = 0,
    take: number = 10,
    sourceSystem?: string,
  ): Promise<PaginatedCommittees> {
    const where: Record<string, unknown> = {};
    if (sourceSystem) where.sourceSystem = sourceSystem;
    const whereClause = Object.keys(where).length > 0 ? where : undefined;

    const [items, total] = await Promise.all([
      this.db.committee.findMany({
        where: whereClause,
        orderBy: [{ name: 'asc' }],
        skip,
        take: take + 1,
      }),
      this.db.committee.count({ where: whereClause }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return {
      items: paginatedItems.map((item: CommitteeRecord) => ({
        ...item,
        candidateName: item.candidateName ?? undefined,
        candidateOffice: item.candidateOffice ?? undefined,
        propositionId: item.propositionId ?? undefined,
        party: item.party ?? undefined,
        sourceUrl: item.sourceUrl ?? undefined,
      })),
      total,
      hasMore,
    };
  }

  async getCommittee(id: string) {
    return this.db.committee.findUnique({ where: { id } });
  }

  async getContributions(
    skip: number = 0,
    take: number = 10,
    committeeId?: string,
    sourceSystem?: string,
  ): Promise<PaginatedContributions> {
    const where: Record<string, unknown> = {};
    if (committeeId) where.committeeId = committeeId;
    if (sourceSystem) where.sourceSystem = sourceSystem;
    const whereClause = Object.keys(where).length > 0 ? where : undefined;

    const [items, total] = await Promise.all([
      this.db.contribution.findMany({
        where: whereClause,
        orderBy: [{ date: 'desc' }, { amount: 'desc' }],
        skip,
        take: take + 1,
      }),
      this.db.contribution.count({ where: whereClause }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return {
      items: paginatedItems.map((item: ContributionRecord) => ({
        ...item,
        amount: Number(item.amount),
        donorEmployer: item.donorEmployer ?? undefined,
        donorOccupation: item.donorOccupation ?? undefined,
        donorCity: item.donorCity ?? undefined,
        donorState: item.donorState ?? undefined,
        donorZip: item.donorZip ?? undefined,
        electionType: item.electionType ?? undefined,
        contributionType: item.contributionType ?? undefined,
      })),
      total,
      hasMore,
    };
  }

  async getContribution(id: string) {
    return this.db.contribution.findUnique({ where: { id } });
  }

  async getExpenditures(
    skip: number = 0,
    take: number = 10,
    committeeId?: string,
    sourceSystem?: string,
  ): Promise<PaginatedExpenditures> {
    const where: Record<string, unknown> = {};
    if (committeeId) where.committeeId = committeeId;
    if (sourceSystem) where.sourceSystem = sourceSystem;
    const whereClause = Object.keys(where).length > 0 ? where : undefined;

    const [items, total] = await Promise.all([
      this.db.expenditure.findMany({
        where: whereClause,
        orderBy: [{ date: 'desc' }, { amount: 'desc' }],
        skip,
        take: take + 1,
      }),
      this.db.expenditure.count({ where: whereClause }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return {
      items: paginatedItems.map((item: ExpenditureRecord) => ({
        ...item,
        amount: Number(item.amount),
        purposeDescription: item.purposeDescription ?? undefined,
        expenditureCode: item.expenditureCode ?? undefined,
        candidateName: item.candidateName ?? undefined,
        propositionTitle: item.propositionTitle ?? undefined,
        supportOrOppose: item.supportOrOppose ?? undefined,
      })),
      total,
      hasMore,
    };
  }

  async getExpenditure(id: string) {
    return this.db.expenditure.findUnique({ where: { id } });
  }

  async getIndependentExpenditures(
    skip: number = 0,
    take: number = 10,
    committeeId?: string,
    supportOrOppose?: string,
    sourceSystem?: string,
  ): Promise<PaginatedIndependentExpenditures> {
    const where: Record<string, unknown> = {};
    if (committeeId) where.committeeId = committeeId;
    if (supportOrOppose) where.supportOrOppose = supportOrOppose;
    if (sourceSystem) where.sourceSystem = sourceSystem;
    const whereClause = Object.keys(where).length > 0 ? where : undefined;

    const [items, total] = await Promise.all([
      this.db.independentExpenditure.findMany({
        where: whereClause,
        orderBy: [{ date: 'desc' }, { amount: 'desc' }],
        skip,
        take: take + 1,
      }),
      this.db.independentExpenditure.count({ where: whereClause }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    return {
      items: paginatedItems.map((item: IndependentExpenditureRecord) => ({
        ...item,
        amount: Number(item.amount),
        candidateName: item.candidateName ?? undefined,
        propositionTitle: item.propositionTitle ?? undefined,
        electionDate: item.electionDate ?? undefined,
        description: item.description ?? undefined,
      })),
      total,
      hasMore,
    };
  }

  async getIndependentExpenditure(id: string) {
    return this.db.independentExpenditure.findUnique({ where: { id } });
  }

  // ─── County supervisors ───────────────────────────────────────────────────────

  async getMyCountySupervisors(
    userId: string,
  ): Promise<RepresentativeRecord[]> {
    const countyJurisdiction = await this.db.userJurisdiction.findFirst({
      where: {
        userId,
        userAddress: { isPrimary: true },
        jurisdiction: { type: 'COUNTY' },
      },
      include: { jurisdiction: { select: { fipsCode: true } } },
    });

    const fipsCode = countyJurisdiction?.jurisdiction?.fipsCode;
    if (!fipsCode) return [];

    const plugin = await this.db.regionPlugin.findUnique({
      where: { fipsCode },
      select: { name: true, enabled: true },
    });

    if (!plugin?.enabled) return [];

    return this.getRepresentativesByCounty(plugin.name);
  }

  // ─── Bills query ──────────────────────────────────────────────────────────────

  async getBills(
    skip: number,
    take: number,
    measureTypeCode?: string,
    sessionYear?: string,
    authorId?: string,
    committeeId?: string,
    coAuthorId?: string,
  ): Promise<PaginatedBillsModel> {
    const where = {
      ...(measureTypeCode && { measureTypeCode }),
      ...(sessionYear && { sessionYear }),
      ...(authorId && { authorId }),
      ...(committeeId && {
        committeeReferrals: { some: { legislativeCommitteeId: committeeId } },
      }),
      ...(coAuthorId && {
        coAuthors: { some: { representativeId: coAuthorId } },
      }),
    };

    const [items, total] = await Promise.all([
      this.db.bill.findMany({
        where,
        skip,
        take,
        orderBy: [{ lastActionDate: 'desc' }, { billNumber: 'asc' }],
        include: {
          votes: { orderBy: { voteDate: 'desc' } },
          coAuthors: {
            include: { representative: { select: { id: true, name: true } } },
          },
        },
      }),
      this.db.bill.count({ where }),
    ]);

    return {
      items: items.map((b) => this.mapBillRecord(b)),
      total,
      hasMore: skip + take < total,
    };
  }

  async getBill(id: string): Promise<BillModel | null> {
    const bill = await this.db.bill.findUnique({
      where: { id },
      include: {
        votes: { orderBy: { voteDate: 'desc' } },
        coAuthors: {
          include: { representative: { select: { id: true, name: true } } },
        },
      },
    });
    if (!bill) return null;
    return this.mapBillRecord(bill);
  }

  private mapBillRecord(b: {
    id: string;
    externalId: string;
    billNumber: string;
    sessionYear: string;
    measureTypeCode: string;
    title: string;
    subject: string | null;
    status: string | null;
    currentStageId: string | null;
    lastAction: string | null;
    lastActionDate: Date | null;
    fiscalImpact: string | null;
    fullTextUrl: string | null;
    authorId: string | null;
    authorName: string | null;
    sourceUrl: string;
    extractedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    votes: {
      id: string;
      representativeName: string;
      representativeId: string | null;
      chamber: string;
      voteDate: Date;
      position: string;
      motionText: string | null;
      sourceUrl: string;
    }[];
    coAuthors: {
      representativeId: string;
      coAuthorType: string | null;
      representative: { id: string; name: string };
    }[];
  }): BillModel {
    return {
      id: b.id,
      externalId: b.externalId,
      billNumber: b.billNumber,
      sessionYear: b.sessionYear,
      measureTypeCode: b.measureTypeCode,
      title: b.title,
      subject: b.subject ?? undefined,
      status: b.status ?? undefined,
      currentStageId: b.currentStageId ?? undefined,
      lastAction: b.lastAction ?? undefined,
      lastActionDate: b.lastActionDate ?? undefined,
      fiscalImpact: b.fiscalImpact ?? undefined,
      fullTextUrl: b.fullTextUrl ?? undefined,
      authorId: b.authorId ?? undefined,
      authorName: b.authorName ?? undefined,
      sourceUrl: b.sourceUrl,
      extractedAt: b.extractedAt,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      votes: b.votes.map(
        (v): BillVoteModel => ({
          id: v.id,
          representativeName: v.representativeName,
          representativeId: v.representativeId ?? undefined,
          chamber: v.chamber,
          voteDate: v.voteDate,
          position: v.position,
          motionText: v.motionText ?? undefined,
          sourceUrl: v.sourceUrl,
        }),
      ),
      coAuthors: b.coAuthors.map(
        (c): BillCoAuthorModel => ({
          representativeId: c.representativeId,
          name: c.representative.name,
          coAuthorType: c.coAuthorType ?? undefined,
        }),
      ),
    };
  }

  // ─── Jurisdictions ────────────────────────────────────────────────────────────

  async getJurisdictionsForUser(userId: string): Promise<
    Prisma.UserJurisdictionGetPayload<{
      include: { jurisdiction: { include: { parent: true } } };
    }>[]
  > {
    return this.db.userJurisdiction.findMany({
      where: { userId, userAddress: { isPrimary: true } },
      include: {
        jurisdiction: {
          include: { parent: true },
        },
      },
      orderBy: [
        { jurisdiction: { level: 'asc' } },
        { jurisdiction: { type: 'asc' } },
        { jurisdiction: { name: 'asc' } },
      ],
    });
  }

  // ─── Shared feed helpers ──────────────────────────────────────────────────────

  private windowSince(sinceDays: number): Date {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);
    return since;
  }

  private async actionCountsByType(
    where: Record<string, unknown>,
  ): Promise<Map<string, number>> {
    const groups = await this.db.legislativeAction.groupBy({
      by: ['actionType'],
      where,
      _count: { _all: true },
    });
    const m = new Map<string, number>();
    for (const g of groups) m.set(g.actionType, g._count._all);
    return m;
  }

  private async distinctActionDates(
    where: Record<string, unknown>,
  ): Promise<number> {
    const rows = await this.db.legislativeAction.findMany({
      where,
      distinct: ['date'],
      select: { date: true },
    });
    return rows.length;
  }

  private buildActionFeedWhere(args: {
    representativeId?: string;
    committeeId?: string;
    actionTypes?: string[];
  }): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (args.representativeId) where.representativeId = args.representativeId;
    if (args.committeeId) where.committeeId = args.committeeId;
    if (args.actionTypes?.length) {
      where.actionType = { in: args.actionTypes };
    }
    return where;
  }

  private async paginateLegislativeActions(
    where: Record<string, unknown>,
    skip = 0,
    take = 10,
  ): Promise<LegislativeActionFeedPage> {
    const [rows, total] = await Promise.all([
      this.db.legislativeAction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: take + 1,
        include: { minutes: { select: { externalId: true } } },
      }),
      this.db.legislativeAction.count({ where }),
    ]);

    const hasMore = rows.length > take;
    return {
      items: rows.slice(0, take).map((r) => this.toFeedItem(r)),
      total,
      hasMore,
    };
  }

  private toFeedItem(r: {
    id: string;
    externalId: string;
    body: string;
    date: Date;
    actionType: string;
    position: string | null;
    text: string | null;
    passageStart: number | null;
    passageEnd: number | null;
    rawSubject: string | null;
    representativeId: string | null;
    propositionId: string | null;
    committeeId: string | null;
    minutesId: string;
    minutes: { externalId: string };
  }): LegislativeActionFeedItem {
    return {
      id: r.id,
      externalId: r.externalId,
      body: r.body,
      date: r.date,
      actionType: r.actionType,
      position: r.position,
      text: r.text,
      passageStart: r.passageStart,
      passageEnd: r.passageEnd,
      rawSubject: r.rawSubject,
      representativeId: r.representativeId,
      propositionId: r.propositionId,
      committeeId: r.committeeId,
      minutesId: r.minutesId,
      minutesExternalId: r.minutes.externalId,
    };
  }
}

// Re-export for backward compat — resolver imports this from region.service
// but it now lives in the query service too. The canonical export remains
// in region.service.ts; this is intentional duplication of the type alias.
export type { RepresentativeRecord };
// Also used by resolver directly — must remain importable from region.service
export type { PropositionModel };
