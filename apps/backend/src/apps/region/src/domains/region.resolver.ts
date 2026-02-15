import {
  Args,
  Extensions,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { RegionDomainService } from './region.service';
import {
  RegionInfoModel,
  SyncResultModel,
  DataTypeGQL,
} from './models/region-info.model';
import {
  PropositionModel,
  PaginatedPropositions,
  PropositionStatusGQL,
} from './models/proposition.model';
import { MeetingModel, PaginatedMeetings } from './models/meeting.model';
import {
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

/**
 * Region Resolver
 *
 * GraphQL API for region civic data.
 */
@Resolver()
export class RegionResolver {
  constructor(private readonly regionService: RegionDomainService) {}

  /**
   * Get region information
   */
  @Query(() => RegionInfoModel)
  async regionInfo(): Promise<RegionInfoModel> {
    return this.regionService.getRegionInfo();
  }

  /**
   * Get paginated propositions
   */
  @Query(() => PaginatedPropositions)
  @Extensions({ complexity: 15 }) // Paginated list query
  async propositions(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<PaginatedPropositions> {
    return this.regionService.getPropositions(skip, take);
  }

  /**
   * Get a single proposition by ID
   */
  @Query(() => PropositionModel, { nullable: true })
  async proposition(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<PropositionModel | null> {
    const result = await this.regionService.getProposition(id);
    if (!result) return null;
    // Convert database nulls to GraphQL undefined
    return {
      ...result,
      fullText: result.fullText ?? undefined,
      electionDate: result.electionDate ?? undefined,
      sourceUrl: result.sourceUrl ?? undefined,
      status: result.status as PropositionStatusGQL,
    };
  }

  /**
   * Get paginated meetings
   */
  @Query(() => PaginatedMeetings)
  @Extensions({ complexity: 15 }) // Paginated list query
  async meetings(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<PaginatedMeetings> {
    return this.regionService.getMeetings(skip, take);
  }

  /**
   * Get a single meeting by ID
   */
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
  @Query(() => PaginatedRepresentatives)
  @Extensions({ complexity: 15 }) // Paginated list query
  async representatives(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
    @Args({ name: 'chamber', nullable: true }) chamber?: string,
  ): Promise<PaginatedRepresentatives> {
    return this.regionService.getRepresentatives(skip, take, chamber);
  }

  /**
   * Get a single representative by ID
   */
  @Query(() => RepresentativeModel, { nullable: true })
  async representative(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<RepresentativeModel | null> {
    const result = await this.regionService.getRepresentative(id);
    if (!result) return null;
    // Convert database nulls to GraphQL undefined
    return {
      ...result,
      photoUrl: result.photoUrl ?? undefined,
      contactInfo: (result.contactInfo as ContactInfoModel) ?? undefined,
    };
  }

  // ==========================================
  // CAMPAIGN FINANCE QUERIES
  // ==========================================

  /**
   * Get paginated committees
   */
  @Query(() => PaginatedCommittees)
  @Extensions({ complexity: 15 })
  async committees(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
    @Args({ name: 'sourceSystem', nullable: true }) sourceSystem?: string,
  ): Promise<PaginatedCommittees> {
    return this.regionService.getCommittees(skip, take, sourceSystem);
  }

  /**
   * Get a single committee by ID
   */
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
  @Query(() => PaginatedContributions)
  @Extensions({ complexity: 15 })
  async contributions(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
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
  @Query(() => PaginatedExpenditures)
  @Extensions({ complexity: 15 })
  async expenditures(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
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
  @Query(() => PaginatedIndependentExpenditures)
  @Extensions({ complexity: 15 })
  async independentExpenditures(
    @Args({ name: 'skip', type: () => Int, defaultValue: 0 }) skip: number,
    @Args({ name: 'take', type: () => Int, defaultValue: 10 }) take: number,
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

  /**
   * Trigger a full data sync
   * Note: In production, this should be protected with admin auth
   */
  @Mutation(() => [SyncResultModel])
  @Extensions({ complexity: 100 }) // Full data sync - expensive operation
  async syncRegionData(): Promise<SyncResultModel[]> {
    const results = await this.regionService.syncAll();
    return results.map((r) => ({
      ...r,
      dataType: r.dataType as unknown as DataTypeGQL,
    }));
  }
}
