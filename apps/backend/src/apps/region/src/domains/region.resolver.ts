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
  CivicDataTypeGQL,
} from './models/region-info.model';
import {
  PropositionModel,
  PaginatedPropositions,
  PropositionStatusGQL,
} from './models/proposition.model';
import { MeetingModel, PaginatedMeetings } from './models/meeting.model';
import {
  RepresentativeModel,
  PaginatedRepresentatives,
} from './models/representative.model';

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
    return {
      ...result,
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
    return this.regionService.getMeeting(id);
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
    return this.regionService.getRepresentative(id);
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
      dataType: r.dataType as unknown as CivicDataTypeGQL,
    }));
  }
}
