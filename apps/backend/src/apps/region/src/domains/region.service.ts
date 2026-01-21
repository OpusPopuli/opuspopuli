import { Injectable, Logger } from '@nestjs/common';
import {
  RegionService as RegionProviderService,
  CivicDataType,
  SyncResult,
} from '@qckstrt/region-provider';
import { DbService } from '@qckstrt/relationaldb-provider';
import { RegionInfoModel, CivicDataTypeGQL } from './models/region-info.model';
import {
  PaginatedPropositions,
  PropositionStatusGQL,
} from './models/proposition.model';
import { PaginatedMeetings } from './models/meeting.model';
import {
  ContactInfoModel,
  PaginatedRepresentatives,
} from './models/representative.model';

// Type aliases for database query results
type ExternalIdRecord = { externalId: string };
type PropositionRecord = {
  id: string;
  externalId: string;
  title: string;
  summary: string;
  fullText: string | null;
  status: string;
  electionDate: Date | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};
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
type RepresentativeRecord = {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  district: string;
  party: string | null;
  photoUrl: string | null;
  contactInfo: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Region Domain Service
 *
 * Handles civic data management for the region.
 * Syncs data from the provider and stores in the database.
 */
@Injectable()
export class RegionDomainService {
  private readonly logger = new Logger(RegionDomainService.name, {
    timestamp: true,
  });

  constructor(
    private readonly regionService: RegionProviderService,
    private readonly db: DbService,
  ) {
    const info = regionService.getRegionInfo();
    this.logger.log(
      `RegionDomainService initialized with provider: ${regionService.getProviderName()} (${info.name})`,
    );
  }

  /**
   * Get region information
   */
  getRegionInfo(): RegionInfoModel {
    const info = this.regionService.getRegionInfo();
    const supportedTypes = this.regionService.getSupportedDataTypes();

    return {
      id: info.id,
      name: info.name,
      description: info.description,
      timezone: info.timezone,
      dataSourceUrls: info.dataSourceUrls,
      supportedDataTypes: supportedTypes.map(
        (t) => t as unknown as CivicDataTypeGQL,
      ),
    };
  }

  /**
   * Sync all data types from the provider
   */
  async syncAll(): Promise<SyncResult[]> {
    this.logger.log('Starting full data sync');
    const results: SyncResult[] = [];

    const supportedTypes = this.regionService.getSupportedDataTypes();

    for (const dataType of supportedTypes) {
      try {
        const result = await this.syncDataType(dataType);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync ${dataType}:`, error);
        results.push({
          dataType,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          errors: [(error as Error).message],
          syncedAt: new Date(),
        });
      }
    }

    this.logger.log(`Sync complete. Processed ${results.length} data types.`);
    return results;
  }

  /**
   * Sync a specific data type
   */
  async syncDataType(dataType: CivicDataType): Promise<SyncResult> {
    this.logger.log(`Syncing ${dataType}`);
    const startTime = Date.now();

    const syncHandlers: Record<
      CivicDataType,
      () => Promise<{ processed: number; created: number; updated: number }>
    > = {
      [CivicDataType.PROPOSITIONS]: () => this.syncPropositions(),
      [CivicDataType.MEETINGS]: () => this.syncMeetings(),
      [CivicDataType.REPRESENTATIVES]: () => this.syncRepresentatives(),
    };

    const handler = syncHandlers[dataType];
    const { processed, created, updated } = await handler();

    const duration = Date.now() - startTime;
    this.logger.log(
      `Synced ${dataType}: ${processed} items (${created} created, ${updated} updated) in ${duration}ms`,
    );

    return {
      dataType,
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      errors: [],
      syncedAt: new Date(),
    };
  }

  /**
   * Sync propositions using bulk upsert
   *
   * PERFORMANCE: Uses batch upsert instead of N+1 queries
   * This reduces database round trips from O(2n) to O(2) queries
   */
  private async syncPropositions(): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const propositions = await this.regionService.fetchPropositions();
    if (propositions.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    // Get existing externalIds in a single query to calculate created vs updated
    const externalIds = propositions.map((p) => p.externalId);
    const existingRecords = await this.db.proposition.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingExternalIds = new Set(
      existingRecords.map((r: ExternalIdRecord) => r.externalId),
    );

    // Batch upsert all propositions using database transaction
    await this.db.$transaction(
      propositions.map((prop) =>
        this.db.proposition.upsert({
          where: { externalId: prop.externalId },
          update: {
            title: prop.title,
            summary: prop.summary,
            fullText: prop.fullText,
            status: prop.status,
            electionDate: prop.electionDate,
            sourceUrl: prop.sourceUrl,
          },
          create: {
            externalId: prop.externalId,
            title: prop.title,
            summary: prop.summary,
            fullText: prop.fullText,
            status: prop.status,
            electionDate: prop.electionDate,
            sourceUrl: prop.sourceUrl,
          },
        }),
      ),
    );

    const created = propositions.filter(
      (p) => !existingExternalIds.has(p.externalId),
    ).length;
    const updated = propositions.filter((p) =>
      existingExternalIds.has(p.externalId),
    ).length;

    return { processed: propositions.length, created, updated };
  }

  /**
   * Sync meetings using bulk upsert
   *
   * PERFORMANCE: Uses batch upsert instead of N+1 queries
   * This reduces database round trips from O(2n) to O(2) queries
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/197
   */
  private async syncMeetings(): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const meetings = await this.regionService.fetchMeetings();
    if (meetings.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    // Get existing externalIds in a single query to calculate created vs updated
    const externalIds = meetings.map((m) => m.externalId);
    const existingRecords = await this.db.meeting.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingExternalIds = new Set(
      existingRecords.map((r: ExternalIdRecord) => r.externalId),
    );

    // Batch upsert all meetings using database transaction
    await this.db.$transaction(
      meetings.map((meeting) =>
        this.db.meeting.upsert({
          where: { externalId: meeting.externalId },
          update: {
            title: meeting.title,
            body: meeting.body,
            scheduledAt: meeting.scheduledAt,
            location: meeting.location,
            agendaUrl: meeting.agendaUrl,
            videoUrl: meeting.videoUrl,
          },
          create: {
            externalId: meeting.externalId,
            title: meeting.title,
            body: meeting.body,
            scheduledAt: meeting.scheduledAt,
            location: meeting.location,
            agendaUrl: meeting.agendaUrl,
            videoUrl: meeting.videoUrl,
          },
        }),
      ),
    );

    const created = meetings.filter(
      (m) => !existingExternalIds.has(m.externalId),
    ).length;
    const updated = meetings.filter((m) =>
      existingExternalIds.has(m.externalId),
    ).length;

    return { processed: meetings.length, created, updated };
  }

  /**
   * Sync representatives using bulk upsert
   *
   * PERFORMANCE: Uses batch upsert instead of N+1 queries
   * This reduces database round trips from O(2n) to O(2) queries
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/197
   */
  private async syncRepresentatives(): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const reps = await this.regionService.fetchRepresentatives();
    if (reps.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    // Get existing externalIds in a single query to calculate created vs updated
    const externalIds = reps.map((r) => r.externalId);
    const existingRecords = await this.db.representative.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingExternalIds = new Set(
      existingRecords.map((r: ExternalIdRecord) => r.externalId),
    );

    // Batch upsert all representatives using database transaction
    await this.db.$transaction(
      reps.map((rep) =>
        this.db.representative.upsert({
          where: { externalId: rep.externalId },
          update: {
            name: rep.name,
            chamber: rep.chamber,
            district: rep.district,
            party: rep.party,
            photoUrl: rep.photoUrl,
            contactInfo: rep.contactInfo as object | undefined,
          },
          create: {
            externalId: rep.externalId,
            name: rep.name,
            chamber: rep.chamber,
            district: rep.district,
            party: rep.party,
            photoUrl: rep.photoUrl,
            contactInfo: rep.contactInfo as object | undefined,
          },
        }),
      ),
    );

    const created = reps.filter(
      (r) => !existingExternalIds.has(r.externalId),
    ).length;
    const updated = reps.filter((r) =>
      existingExternalIds.has(r.externalId),
    ).length;

    return { processed: reps.length, created, updated };
  }

  /**
   * Get propositions with pagination
   */
  async getPropositions(
    skip: number = 0,
    take: number = 10,
  ): Promise<PaginatedPropositions> {
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

    // Cast database types to GraphQL types - enum values are compatible at runtime
    return {
      items: paginatedItems.map((item: PropositionRecord) => ({
        ...item,
        fullText: item.fullText ?? undefined,
        electionDate: item.electionDate ?? undefined,
        sourceUrl: item.sourceUrl ?? undefined,
        status: item.status as unknown as PropositionStatusGQL,
      })),
      total,
      hasMore,
    };
  }

  /**
   * Get a single proposition by ID
   */
  async getProposition(id: string) {
    return this.db.proposition.findUnique({ where: { id } });
  }

  /**
   * Get meetings with pagination
   */
  async getMeetings(
    skip: number = 0,
    take: number = 10,
  ): Promise<PaginatedMeetings> {
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

    // Cast database types to GraphQL types
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
  }

  /**
   * Get a single meeting by ID
   */
  async getMeeting(id: string) {
    return this.db.meeting.findUnique({ where: { id } });
  }

  /**
   * Get representatives with pagination
   */
  async getRepresentatives(
    skip: number = 0,
    take: number = 10,
    chamber?: string,
  ): Promise<PaginatedRepresentatives> {
    const where = chamber ? { chamber } : undefined;

    const [items, total] = await Promise.all([
      this.db.representative.findMany({
        where,
        orderBy: [{ chamber: 'asc' }, { name: 'asc' }],
        skip,
        take: take + 1,
      }),
      this.db.representative.count({ where }),
    ]);

    const hasMore = items.length > take;
    const paginatedItems = items.slice(0, take);

    // Cast database types to GraphQL types
    return {
      items: paginatedItems.map((item: RepresentativeRecord) => ({
        ...item,
        party: item.party ?? undefined,
        photoUrl: item.photoUrl ?? undefined,
        contactInfo: (item.contactInfo as ContactInfoModel) ?? undefined,
      })),
      total,
      hasMore,
    };
  }

  /**
   * Get a single representative by ID
   */
  async getRepresentative(id: string) {
    return this.db.representative.findUnique({ where: { id } });
  }
}
