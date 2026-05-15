import {
  Args,
  Context,
  Extensions,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { Public } from 'src/common/decorators/public.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { PaginationArgs } from 'src/common/dto/pagination.args';
import { RegionDomainService, mapPropositionRecord } from './region.service';
import {
  RegionInfoModel,
  SyncResultModel,
  DataTypeGQL,
} from './models/region-info.model';
import {
  PropositionModel,
  PaginatedPropositions,
} from './models/proposition.model';
import { PropositionFundingModel } from './models/proposition-funding.model';
import { MeetingModel, PaginatedMeetings } from './models/meeting.model';
import {
  BioClaimModel,
  CommitteeAssignmentModel,
  ContactInfoModel,
  RepresentativeModel,
  PaginatedRepresentatives,
} from './models/representative.model';
import { CommitteeModel, PaginatedCommittees } from './models/committee.model';
import {
  ContributionModel,
  PaginatedContributions,
} from './models/contribution.model';
import {
  ExpenditureModel,
  PaginatedExpenditures,
} from './models/expenditure.model';
import {
  IndependentExpenditureModel,
  PaginatedIndependentExpenditures,
} from './models/independent-expenditure.model';
import {
  LegislativeCommitteeDetailModel,
  PaginatedLegislativeCommittees,
} from './models/legislative-committee.model';
import {
  LegislativeActionModel,
  RepresentativeActivityStatsModel,
  CommitteeActivityStatsModel,
  PaginatedLegislativeActions,
  MinutesPassageModel,
} from './models/legislative-action.model';
import { BillModel, PaginatedBillsModel } from './models/bill.model';
import {
  JurisdictionModel,
  UserJurisdictionModel,
} from './models/jurisdiction.model';

/**
 * Region Resolver
 *
 * GraphQL API for region civic data.
 */
@Resolver()
export class RegionResolver {
  constructor(private readonly regionService: RegionDomainService) {}

  /**
   * Get region information, including merged civics data for the active region.
   */
  @Public()
  @Query(() => RegionInfoModel)
  async regionInfo(): Promise<RegionInfoModel> {
    const info = this.regionService.getRegionInfo();
    const civics = await this.regionService.getCivicsData(info.id);
    return { ...info, civics: civics ?? undefined };
  }

  /**
   * Get paginated propositions
   */
  @Public()
  @Query(() => PaginatedPropositions)
  @Extensions({ complexity: 15 }) // Paginated list query
  async propositions(
    @Args() { skip, take }: PaginationArgs,
  ): Promise<PaginatedPropositions> {
    return this.regionService.getPropositions(skip, take);
  }

  /**
   * Get a single proposition by ID
   */
  @Public()
  @Query(() => PropositionModel, { nullable: true })
  async proposition(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<PropositionModel | null> {
    const result = await this.regionService.getProposition(id);
    if (!result) return null;
    return mapPropositionRecord(result);
  }

  /**
   * Aggregated campaign-finance totals for a single proposition. Public
   * so the proposition detail page can render the funding section without
   * authentication. Returns null when no funding has been linked to the
   * proposition (the resolver uses the model's nullable mapping; the
   * service itself returns an all-zeros shape when the proposition exists
   * but has no positions or IEs yet).
   */
  @Public()
  @Query(() => PropositionFundingModel, { nullable: true })
  @Extensions({ complexity: 25 })
  async propositionFunding(
    @Args({ name: 'propositionId', type: () => ID }) propositionId: string,
  ): Promise<PropositionFundingModel | null> {
    const funding =
      await this.regionService.getPropositionFunding(propositionId);
    if (!funding) return null;
    return funding as unknown as PropositionFundingModel;
  }

  /**
   * Regenerate AI analysis for a single proposition (admin only).
   * Forces a fresh LLM run regardless of cached prompt hash. Useful
   * after a prompt-template revision or to recover a malformed analysis.
   * Returns the updated proposition.
   */
  @Mutation(() => PropositionModel, { nullable: true })
  @UseGuards(AuthGuard)
  @Roles(Role.Admin)
  @Extensions({ complexity: 50 })
  async regeneratePropositionAnalysis(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<PropositionModel | null> {
    await this.regionService.regeneratePropositionAnalysis(id);
    const result = await this.regionService.getProposition(id);
    if (!result) return null;
    return mapPropositionRecord(result);
  }

  /**
   * Get paginated meetings
   */
  @Public()
  @Query(() => PaginatedMeetings)
  @Extensions({ complexity: 15 }) // Paginated list query
  async meetings(
    @Args() { skip, take }: PaginationArgs,
  ): Promise<PaginatedMeetings> {
    return this.regionService.getMeetings(skip, take);
  }

  /**
   * Get a single meeting by ID
   */
  @Public()
  @Query(() => MeetingModel, { nullable: true })
  async meeting(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<MeetingModel | null> {
    const result = await this.regionService.getMeeting(id);
    if (!result) return null;
    // Convert database nulls to GraphQL undefined
    return {
      ...result,
      location: result.location ?? undefined,
      agendaUrl: result.agendaUrl ?? undefined,
      videoUrl: result.videoUrl ?? undefined,
    };
  }

  /**
   * Get paginated representatives
   */
  @Public()
  @Query(() => PaginatedRepresentatives)
  @Extensions({ complexity: 15 }) // Paginated list query
  async representatives(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'chamber', nullable: true }) chamber?: string,
  ): Promise<PaginatedRepresentatives> {
    return this.regionService.getRepresentatives(skip, take, chamber);
  }

  /**
   * Get a single representative by ID
   */
  @Public()
  @Query(() => RepresentativeModel, { nullable: true })
  async representative(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<RepresentativeModel | null> {
    const result = await this.regionService.getRepresentative(id);
    if (!result) return null;

    // Resolve each JSONB committee entry to its LegislativeCommittee.id
    // so the frontend can render a link into the committee detail page.
    const rawCommittees =
      (result.committees as unknown as CommitteeAssignmentModel[]) ?? [];
    const idByName = await this.regionService.resolveLegislativeCommitteeIds(
      result.chamber,
      rawCommittees,
    );
    const enrichedCommittees = rawCommittees.length
      ? rawCommittees.map((c) => ({
          ...c,
          legislativeCommitteeId:
            idByName.get(c.name?.trim() ?? '') ?? undefined,
        }))
      : undefined;

    return {
      ...result,
      photoUrl: result.photoUrl ?? undefined,
      contactInfo: (result.contactInfo as ContactInfoModel) ?? undefined,
      committees: enrichedCommittees,
      committeesSummary: result.committeesSummary ?? undefined,
      bio: result.bio ?? undefined,
      bioSource: result.bioSource ?? undefined,
      bioClaims: Array.isArray(result.bioClaims)
        ? (result.bioClaims as unknown as BioClaimModel[])
        : undefined,
      activitySummary: result.activitySummary ?? undefined,
      activitySummaryGeneratedAt:
        result.activitySummaryGeneratedAt ?? undefined,
      activitySummaryWindowDays: result.activitySummaryWindowDays ?? undefined,
    };
  }

  /**
   * Find representatives matching a user's civic districts.
   * Districts come from the user's geocoded address (Census API format).
   */
  @Public()
  @Query(() => [RepresentativeModel])
  async representativesByDistricts(
    @Args({ name: 'congressionalDistrict', nullable: true })
    congressionalDistrict?: string,
    @Args({ name: 'stateSenatorialDistrict', nullable: true })
    stateSenatorialDistrict?: string,
    @Args({ name: 'stateAssemblyDistrict', nullable: true })
    stateAssemblyDistrict?: string,
  ): Promise<RepresentativeModel[]> {
    const results = await this.regionService.getRepresentativesByDistricts(
      congressionalDistrict,
      stateSenatorialDistrict,
      stateAssemblyDistrict,
    );

    return results.map((r) => ({
      ...r,
      party: r.party ?? undefined,
      photoUrl: r.photoUrl ?? undefined,
      contactInfo: (r.contactInfo as ContactInfoModel) ?? undefined,
      committees: (r.committees as CommitteeAssignmentModel[]) ?? undefined,
      committeesSummary: r.committeesSummary ?? undefined,
      bio: r.bio ?? undefined,
      bioSource: r.bioSource ?? undefined,
      bioClaims: Array.isArray(r.bioClaims)
        ? (r.bioClaims as unknown as BioClaimModel[])
        : undefined,
    })) as RepresentativeModel[];
  }

  // ==========================================
  // LEGISLATIVE ACTION QUERIES (issue #665)
  // ==========================================

  /**
   * At-a-glance activity counters for the rep detail page Layer 3.
   * Window defaults to 90 days; tune `sinceDays` for different
   * surfaces (e.g. session-long stats vs. last-month).
   */
  @Public()
  @Query(() => RepresentativeActivityStatsModel)
  async representativeActivityStats(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Args({ name: 'sinceDays', type: () => Int, nullable: true })
    sinceDays?: number,
  ): Promise<RepresentativeActivityStatsModel> {
    return this.regionService.getRepresentativeActivityStats(
      id,
      sinceDays ?? 90,
    );
  }

  /**
   * Reverse-chronological feed of LegislativeActions for a rep.
   * `presence:yes` rows are filtered out by default — they're the
   * highest-volume / lowest-signal entries and are already
   * summarized in the attendance counter. Pass
   * `actionTypes: ["presence"]` (or set `includePresenceYes`) to
   * include them.
   */
  @Public()
  @Query(() => PaginatedLegislativeActions)
  async representativeActivity(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Args({ name: 'actionTypes', type: () => [String], nullable: true })
    actionTypes?: string[],
    @Args({ name: 'includePresenceYes', nullable: true })
    includePresenceYes?: boolean,
    @Args({ name: 'skip', type: () => Int, nullable: true }) skip?: number,
    @Args({ name: 'take', type: () => Int, nullable: true }) take?: number,
  ): Promise<PaginatedLegislativeActions> {
    const result = await this.regionService.getRepresentativeActivity({
      representativeId: id,
      actionTypes,
      includePresenceYes,
      skip: skip ?? 0,
      take: take ?? 10,
    });
    return {
      items: result.items.map((r) => this.toLegislativeActionModel(r)),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  /**
   * Resolve a single LegislativeAction to its source passage —
   * verbatim text from `Minutes.rawText`. Returns null when the
   * action has no passage offsets recorded or the parent Minutes
   * has no rawText.
   */
  @Public()
  @Query(() => MinutesPassageModel, { nullable: true })
  async minutesPassage(
    @Args({ name: 'actionId', type: () => ID }) actionId: string,
  ): Promise<MinutesPassageModel | null> {
    return this.regionService.getMinutesPassage(actionId);
  }

  /**
   * At-a-glance activity counters for the legislative committee
   * detail page Layer 3. Window defaults to 90 days.
   */
  @Public()
  @Query(() => CommitteeActivityStatsModel)
  async committeeActivityStats(
    @Args({ name: 'committeeId', type: () => ID }) committeeId: string,
    @Args({ name: 'sinceDays', type: () => Int, nullable: true })
    sinceDays?: number,
  ): Promise<CommitteeActivityStatsModel> {
    return this.regionService.getCommitteeActivityStats(
      committeeId,
      sinceDays ?? 90,
    );
  }

  /**
   * Reverse-chronological feed of LegislativeActions linked to a
   * legislative committee — committee_hearing + committee_report +
   * amendment rows from minutes ingestion. Mirrors
   * `representativeActivity` but scoped by committeeId; no
   * presence-row filtering needed (presence rows aren't
   * committee-attributed).
   */
  @Public()
  @Query(() => PaginatedLegislativeActions)
  async committeeActivity(
    @Args({ name: 'committeeId', type: () => ID }) committeeId: string,
    @Args({ name: 'actionTypes', type: () => [String], nullable: true })
    actionTypes?: string[],
    @Args({ name: 'skip', type: () => Int, nullable: true }) skip?: number,
    @Args({ name: 'take', type: () => Int, nullable: true }) take?: number,
  ): Promise<PaginatedLegislativeActions> {
    const result = await this.regionService.getCommitteeActivity({
      committeeId,
      actionTypes,
      skip: skip ?? 0,
      take: take ?? 10,
    });
    return {
      items: result.items.map((r) => this.toLegislativeActionModel(r)),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  private toLegislativeActionModel(r: {
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
  }): LegislativeActionModel {
    return {
      id: r.id,
      externalId: r.externalId,
      body: r.body,
      date: r.date,
      actionType: r.actionType,
      position: r.position ?? undefined,
      text: r.text ?? undefined,
      passageStart: r.passageStart ?? undefined,
      passageEnd: r.passageEnd ?? undefined,
      rawSubject: r.rawSubject ?? undefined,
      representativeId: r.representativeId ?? undefined,
      propositionId: r.propositionId ?? undefined,
      committeeId: r.committeeId ?? undefined,
      minutesId: r.minutesId,
      minutesExternalId: r.minutesExternalId,
    };
  }

  // ==========================================
  // LEGISLATIVE COMMITTEE QUERIES
  // ==========================================

  /**
   * Paginated list of legislative committees, optionally filtered by
   * chamber and/or a case-insensitive substring on `name`. The
   * `nameFilter` arg powers the as-you-type search box on the
   * committees list page (#672) — when non-empty, callers typically
   * also bump `take` past PAGE_SIZE so results aren't truncated by
   * the default page.
   */
  @Public()
  @Query(() => PaginatedLegislativeCommittees)
  @Extensions({ complexity: 15 })
  async legislativeCommittees(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'chamber', nullable: true }) chamber?: string,
    @Args({ name: 'nameFilter', nullable: true }) nameFilter?: string,
  ): Promise<PaginatedLegislativeCommittees> {
    const result = await this.regionService.listLegislativeCommittees({
      skip,
      take,
      chamber,
      nameFilter,
    });
    return {
      items: result.items.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        name: c.name,
        chamber: c.chamber,
        url: c.url ?? undefined,
        description: c.description ?? undefined,
        memberCount: c.memberCount,
      })),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  /**
   * Detail view: committee + sorted members + best-effort recent hearings.
   */
  @Public()
  @Query(() => LegislativeCommitteeDetailModel, { nullable: true })
  async legislativeCommittee(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<LegislativeCommitteeDetailModel | null> {
    const result = await this.regionService.getLegislativeCommittee(id);
    if (!result) return null;
    return {
      id: result.id,
      externalId: result.externalId,
      name: result.name,
      chamber: result.chamber,
      url: result.url ?? undefined,
      description: result.description ?? undefined,
      memberCount: result.memberCount,
      members: result.members.map((m) => ({
        representativeId: m.representativeId,
        name: m.name,
        role: m.role ?? undefined,
        party: m.party,
        photoUrl: m.photoUrl ?? undefined,
      })),
      hearings: result.hearings.map((h) => ({
        id: h.id,
        title: h.title,
        scheduledAt: h.scheduledAt,
        agendaUrl: h.agendaUrl ?? undefined,
      })),
      activitySummary: result.activitySummary ?? undefined,
      activitySummaryGeneratedAt:
        result.activitySummaryGeneratedAt ?? undefined,
      activitySummaryWindowDays: result.activitySummaryWindowDays ?? undefined,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  // ==========================================
  // CAMPAIGN FINANCE QUERIES
  // ==========================================

  /**
   * Get paginated committees
   */
  @Public()
  @Query(() => PaginatedCommittees)
  @Extensions({ complexity: 15 })
  async committees(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'sourceSystem', nullable: true }) sourceSystem?: string,
  ): Promise<PaginatedCommittees> {
    return this.regionService.getCommittees(skip, take, sourceSystem);
  }

  /**
   * Get a single committee by ID
   */
  @Public()
  @Query(() => CommitteeModel, { nullable: true })
  async committee(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<CommitteeModel | null> {
    const result = await this.regionService.getCommittee(id);
    if (!result) return null;
    return {
      ...result,
      candidateName: result.candidateName ?? undefined,
      candidateOffice: result.candidateOffice ?? undefined,
      propositionId: result.propositionId ?? undefined,
      party: result.party ?? undefined,
      sourceUrl: result.sourceUrl ?? undefined,
    };
  }

  /**
   * Get paginated contributions
   */
  @Public()
  @Query(() => PaginatedContributions)
  @Extensions({ complexity: 15 })
  async contributions(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'committeeId', nullable: true }) committeeId?: string,
    @Args({ name: 'sourceSystem', nullable: true }) sourceSystem?: string,
  ): Promise<PaginatedContributions> {
    return this.regionService.getContributions(
      skip,
      take,
      committeeId,
      sourceSystem,
    );
  }

  /**
   * Get a single contribution by ID
   */
  @Public()
  @Query(() => ContributionModel, { nullable: true })
  async contribution(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<ContributionModel | null> {
    const result = await this.regionService.getContribution(id);
    if (!result) return null;
    return {
      ...result,
      amount: Number(result.amount),
      donorEmployer: result.donorEmployer ?? undefined,
      donorOccupation: result.donorOccupation ?? undefined,
      donorCity: result.donorCity ?? undefined,
      donorState: result.donorState ?? undefined,
      donorZip: result.donorZip ?? undefined,
      electionType: result.electionType ?? undefined,
      contributionType: result.contributionType ?? undefined,
    };
  }

  /**
   * Get paginated expenditures
   */
  @Public()
  @Query(() => PaginatedExpenditures)
  @Extensions({ complexity: 15 })
  async expenditures(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'committeeId', nullable: true }) committeeId?: string,
    @Args({ name: 'sourceSystem', nullable: true }) sourceSystem?: string,
  ): Promise<PaginatedExpenditures> {
    return this.regionService.getExpenditures(
      skip,
      take,
      committeeId,
      sourceSystem,
    );
  }

  /**
   * Get a single expenditure by ID
   */
  @Public()
  @Query(() => ExpenditureModel, { nullable: true })
  async expenditure(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<ExpenditureModel | null> {
    const result = await this.regionService.getExpenditure(id);
    if (!result) return null;
    return {
      ...result,
      amount: Number(result.amount),
      purposeDescription: result.purposeDescription ?? undefined,
      expenditureCode: result.expenditureCode ?? undefined,
      candidateName: result.candidateName ?? undefined,
      propositionTitle: result.propositionTitle ?? undefined,
      supportOrOppose: result.supportOrOppose ?? undefined,
    };
  }

  /**
   * Get paginated independent expenditures
   */
  @Public()
  @Query(() => PaginatedIndependentExpenditures)
  @Extensions({ complexity: 15 })
  async independentExpenditures(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'committeeId', nullable: true }) committeeId?: string,
    @Args({ name: 'supportOrOppose', nullable: true })
    supportOrOppose?: string,
    @Args({ name: 'sourceSystem', nullable: true }) sourceSystem?: string,
  ): Promise<PaginatedIndependentExpenditures> {
    return this.regionService.getIndependentExpenditures(
      skip,
      take,
      committeeId,
      supportOrOppose,
      sourceSystem,
    );
  }

  /**
   * Get a single independent expenditure by ID
   */
  @Public()
  @Query(() => IndependentExpenditureModel, { nullable: true })
  async independentExpenditure(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<IndependentExpenditureModel | null> {
    const result = await this.regionService.getIndependentExpenditure(id);
    if (!result) return null;
    return {
      ...result,
      amount: Number(result.amount),
      candidateName: result.candidateName ?? undefined,
      propositionTitle: result.propositionTitle ?? undefined,
      electionDate: result.electionDate ?? undefined,
      description: result.description ?? undefined,
    };
  }

  // ==========================================
  // BILL QUERIES (issue #686)
  // ==========================================

  /**
   * Paginated list of bills, optionally filtered by measureTypeCode,
   * sessionYear, or authorId. Orders by lastActionDate desc.
   */
  @Public()
  @Query(() => PaginatedBillsModel)
  @Extensions({ complexity: 15 })
  async bills(
    @Args() { skip, take }: PaginationArgs,
    @Args({ name: 'measureTypeCode', nullable: true }) measureTypeCode?: string,
    @Args({ name: 'sessionYear', nullable: true }) sessionYear?: string,
    @Args({ name: 'authorId', type: () => ID, nullable: true })
    authorId?: string,
    @Args({ name: 'committeeId', type: () => ID, nullable: true })
    committeeId?: string,
  ): Promise<PaginatedBillsModel> {
    return this.regionService.getBills(
      skip,
      take,
      measureTypeCode,
      sessionYear,
      authorId,
      committeeId,
    );
  }

  /**
   * Single bill by ID, including all votes and co-authors.
   */
  @Public()
  @Query(() => BillModel, { nullable: true })
  async bill(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<BillModel | null> {
    return this.regionService.getBill(id);
  }

  /**
   * Trigger a data sync (admin only).
   * Optionally filter by data types — when omitted, syncs all.
   * Optionally cap AI enrichment (bios, committee summaries) at
   * `maxReps` per run — useful during testing to verify pipeline
   * plumbing without a full-roster LLM cycle. When omitted, falls
   * back to the generator env-var caps (or unlimited).
   */
  // ==========================================
  // JURISDICTION RESOLUTION (#690)
  // ==========================================

  /**
   * Return all civic jurisdictions resolved for the authenticated user's
   * primary address, grouped by level (legislative → county → municipal → district).
   */
  @Query(() => [UserJurisdictionModel])
  @UseGuards(AuthGuard)
  @Extensions({ complexity: 10 })
  async myJurisdictions(
    @Context() context: GqlContext,
  ): Promise<UserJurisdictionModel[]> {
    const user = getUserFromContext(context);
    const rows = await this.regionService.getJurisdictionsForUser(user.id);

    return rows.map((row) => ({
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt,
      jurisdiction: {
        ...row.jurisdiction,
        fipsCode: row.jurisdiction.fipsCode ?? undefined,
        ocdId: row.jurisdiction.ocdId ?? undefined,
        parent: row.jurisdiction.parent
          ? {
              ...row.jurisdiction.parent,
              fipsCode: row.jurisdiction.parent.fipsCode ?? undefined,
              ocdId: row.jurisdiction.parent.ocdId ?? undefined,
            }
          : undefined,
      } as JurisdictionModel,
    }));
  }

  @Mutation(() => [SyncResultModel])
  @UseGuards(AuthGuard)
  @Roles(Role.Admin)
  @Extensions({ complexity: 100 }) // Full data sync - expensive operation
  async syncRegionData(
    @Args('dataTypes', { type: () => [DataTypeGQL], nullable: true })
    dataTypes?: DataTypeGQL[],
    @Args('maxReps', { type: () => Int, nullable: true })
    maxReps?: number,
    @Args('maxBills', { type: () => Int, nullable: true })
    maxBills?: number,
  ): Promise<SyncResultModel[]> {
    const results = await this.regionService.syncAll(
      dataTypes as unknown as string[],
      maxReps,
      maxBills,
    );
    return results.map((r) => ({
      ...r,
      dataType: r.dataType as unknown as DataTypeGQL,
    }));
  }
}
