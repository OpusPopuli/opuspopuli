import {
  Args,
  Extensions,
  ID,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { Public } from 'src/common/decorators/public.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { PaginationArgs } from 'src/common/dto/pagination.args';
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
  @Public()
  @Query(() => RegionInfoModel)
  async regionInfo(): Promise<RegionInfoModel> {
    return this.regionService.getRegionInfo();
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
    // Convert database nulls to GraphQL undefined
    return {
      ...result,
      photoUrl: result.photoUrl ?? undefined,
      contactInfo: (result.contactInfo as ContactInfoModel) ?? undefined,
      committees:
        (result.committees as unknown as CommitteeAssignmentModel[]) ??
        undefined,
      bio: result.bio ?? undefined,
      bioSource: result.bioSource ?? undefined,
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
      bio: r.bio ?? undefined,
      bioSource: r.bioSource ?? undefined,
    })) as RepresentativeModel[];
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

  /**
   * Trigger a data sync (admin only).
   * Optionally filter by data types — when omitted, syncs all.
   */
  @Mutation(() => [SyncResultModel])
  @UseGuards(AuthGuard)
  @Roles(Role.Admin)
  @Extensions({ complexity: 100 }) // Full data sync - expensive operation
  async syncRegionData(
    @Args('dataTypes', { type: () => [DataTypeGQL], nullable: true })
    dataTypes?: DataTypeGQL[],
  ): Promise<SyncResultModel[]> {
    const results = await this.regionService.syncAll(
      dataTypes as unknown as string[],
    );
    return results.map((r) => ({
      ...r,
      dataType: r.dataType as unknown as DataTypeGQL,
    }));
  }
}
