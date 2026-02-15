import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  RegionService as RegionProviderService,
  DataType,
  SyncResult,
  PluginLoaderService,
  PluginRegistryService,
  ExampleRegionProvider,
  discoverRegionConfigs,
  type IPipelineService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import {
  resolveConfigPlaceholders,
  type Proposition,
  type Meeting,
  type Representative,
  type CampaignFinanceResult,
} from '@opuspopuli/common';

/**
 * Minimal interface for data fetching used by sync methods.
 * Satisfied by both RegionProviderService and IRegionPlugin.
 */
interface DataFetcher {
  fetchPropositions(): Promise<Proposition[]>;
  fetchMeetings(): Promise<Meeting[]>;
  fetchRepresentatives(): Promise<Representative[]>;
  fetchCampaignFinance?(): Promise<CampaignFinanceResult>;
}
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { RegionInfoModel, DataTypeGQL } from './models/region-info.model';
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
 * Loads two plugins at startup:
 * - Federal plugin (always loaded): FEC campaign finance data
 * - Local plugin (user-selected): state civic data + state campaign finance
 *
 * Syncs data from both plugins and stores in the database.
 */
@Injectable()
export class RegionDomainService implements OnModuleInit {
  private readonly logger = new Logger(RegionDomainService.name, {
    timestamp: true,
  });
  private regionService!: RegionProviderService;

  constructor(
    private readonly pluginLoader: PluginLoaderService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly db: DbService,
    @Optional()
    @Inject('SCRAPING_PIPELINE')
    private readonly pipeline?: IPipelineService,
  ) {}

  /**
   * Load region plugins at startup:
   * 1. Sync JSON config files to the database
   * 2. Always load the federal plugin (FEC data)
   * 3. Load the enabled local plugin (state civic data)
   * Falls back to ExampleRegionProvider if no local plugin is configured.
   */
  async onModuleInit(): Promise<void> {
    await this.syncRegionConfigs();

    // Read the local config's stateCode for resolving federal config placeholders.
    // This is a lightweight read — we only need stateCode, not the full plugin load.
    const localConfigRow = await this.db.regionPlugin.findFirst({
      where: { enabled: true, name: { not: 'federal' } },
    });

    const localConfigData = localConfigRow?.config as
      | Record<string, unknown>
      | undefined;
    const stateCode = localConfigData?.stateCode as string | undefined;

    // Build variable map for placeholder resolution (e.g., ${stateCode} → "CA")
    const variables: Record<string, string> = {};
    if (stateCode) {
      variables['stateCode'] = stateCode;
    }

    // 1. ALWAYS load federal (not gated by DB enabled flag)
    try {
      const federalConfig = await this.db.regionPlugin.findUnique({
        where: { name: 'federal' },
      });

      if (federalConfig) {
        let config = federalConfig.config as Record<string, unknown>;

        // Resolve ${stateCode} (and any future placeholders) in federal config
        if (Object.keys(variables).length > 0) {
          config = resolveConfigPlaceholders(config, variables);
          this.logger.log(
            `Resolved federal config placeholders (stateCode="${stateCode}")`,
          );
        } else {
          this.logger.warn(
            'No local region stateCode available — federal config placeholders will not be resolved',
          );
        }

        this.logger.log('Loading federal plugin');
        await this.pluginLoader.loadFederalPlugin(config, this.pipeline);
      } else {
        this.logger.warn(
          'Federal region config not found in database — FEC data will not be available',
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to load federal plugin: ${(error as Error).message}`,
      );
    }

    // 2. Load the enabled LOCAL plugin (reuse the row already read above)
    try {
      const localConfig = localConfigRow;

      if (localConfig) {
        this.logger.log(
          `Loading local declarative region plugin "${localConfig.name}"`,
        );
        await this.pluginLoader.loadPlugin(
          {
            name: localConfig.name,
            config: localConfig.config as Record<string, unknown> | undefined,
          },
          this.pipeline,
        );
      } else {
        this.logger.warn(
          'No enabled local region plugin found in database, falling back to ExampleRegionProvider',
        );
        await this.pluginRegistry.registerLocal(
          'example',
          this.createFallbackPlugin(),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to load local region plugin, falling back to ExampleRegionProvider: ${(error as Error).message}`,
      );
      await this.pluginRegistry.registerLocal(
        'example',
        this.createFallbackPlugin(),
      );
    }

    // Set up the local region service for GraphQL resolvers (propositions, meetings, reps)
    const localPlugin = this.pluginRegistry.getLocal();
    if (!localPlugin) {
      throw new Error('No local region plugin available after initialization');
    }

    this.regionService = new RegionProviderService(localPlugin);
    const info = this.regionService.getRegionInfo();
    this.logger.log(
      `RegionDomainService initialized — local: ${this.regionService.getProviderName()} (${info.name}), ` +
        `federal: ${this.pluginRegistry.getFederal() ? 'loaded' : 'not loaded'}`,
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
        (t) => t as unknown as DataTypeGQL,
      ),
    };
  }

  /**
   * Sync all data types from all loaded plugins (federal + local).
   */
  async syncAll(): Promise<SyncResult[]> {
    this.logger.log('Starting full data sync');
    const results: SyncResult[] = [];

    for (const registered of this.pluginRegistry.getAll()) {
      const supported = registered.instance.getSupportedDataTypes();

      for (const dataType of supported) {
        try {
          const result = await this.syncDataTypeFrom(
            registered.instance,
            registered.name,
            dataType,
          );
          results.push(result);
        } catch (error) {
          this.logger.error(
            `Failed to sync ${dataType} from ${registered.name}:`,
            error,
          );
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
    }

    this.logger.log(`Sync complete. Processed ${results.length} data types.`);
    return results;
  }

  /**
   * Sync a specific data type from the local plugin.
   * Backward-compatible entry point used by the scheduler.
   */
  async syncDataType(dataType: DataType): Promise<SyncResult> {
    return this.syncDataTypeFrom(
      this.regionService,
      this.pluginRegistry.getActiveName() ?? 'local',
      dataType,
    );
  }

  /**
   * Sync a specific data type from a given provider.
   */
  private async syncDataTypeFrom(
    provider: DataFetcher,
    pluginName: string,
    dataType: DataType,
  ): Promise<SyncResult> {
    this.logger.log(`Syncing ${dataType} from ${pluginName}`);
    const startTime = Date.now();

    const syncHandlers: Partial<
      Record<
        DataType,
        () => Promise<{ processed: number; created: number; updated: number }>
      >
    > = {
      [DataType.PROPOSITIONS]: () => this.syncPropositions(provider),
      [DataType.MEETINGS]: () => this.syncMeetings(provider),
      [DataType.REPRESENTATIVES]: () => this.syncRepresentatives(provider),
      [DataType.CAMPAIGN_FINANCE]: () => this.syncCampaignFinance(provider),
    };

    const handler = syncHandlers[dataType];
    if (!handler) {
      this.logger.warn(`No sync handler for data type: ${dataType}`);
      return {
        dataType,
        itemsProcessed: 0,
        itemsCreated: 0,
        itemsUpdated: 0,
        errors: [`No sync handler for data type: ${dataType}`],
        syncedAt: new Date(),
      };
    }
    const { processed, created, updated } = await handler();

    const duration = Date.now() - startTime;
    this.logger.log(
      `Synced ${dataType} from ${pluginName}: ${processed} items (${created} created, ${updated} updated) in ${duration}ms`,
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
  private async syncPropositions(
    provider: DataFetcher = this.regionService,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const propositions = await provider.fetchPropositions();
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
   * @see https://github.com/OpusPopuli/opuspopuli/issues/197
   */
  private async syncMeetings(
    provider: DataFetcher = this.regionService,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const meetings = await provider.fetchMeetings();
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
   * @see https://github.com/OpusPopuli/opuspopuli/issues/197
   */
  private async syncRepresentatives(
    provider: DataFetcher = this.regionService,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const reps = await provider.fetchRepresentatives();
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
   * Sync campaign finance data (contributions, expenditures, independent expenditures).
   * Called for both federal and local plugins — data is distinguished by sourceSystem.
   */
  private async syncCampaignFinance(provider: DataFetcher): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    if (!provider.fetchCampaignFinance) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const data = await provider.fetchCampaignFinance();
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    // Sync contributions
    if (data.contributions.length > 0) {
      const externalIds = data.contributions.map((c) => c.externalId);
      const existing = await this.db.contribution.findMany({
        where: { externalId: { in: externalIds } },
        select: { externalId: true },
      });
      const existingSet = new Set(
        existing.map((r: ExternalIdRecord) => r.externalId),
      );

      await this.db.$transaction(
        data.contributions.map((c) =>
          this.db.contribution.upsert({
            where: { externalId: c.externalId },
            update: {
              committeeId: c.committeeId,
              donorName: c.donorName,
              donorType: c.donorType,
              donorEmployer: c.donorEmployer,
              donorOccupation: c.donorOccupation,
              donorCity: c.donorCity,
              donorState: c.donorState,
              donorZip: c.donorZip,
              amount: c.amount,
              date: c.date,
              electionType: c.electionType,
              contributionType: c.contributionType,
              sourceSystem: c.sourceSystem,
            },
            create: {
              externalId: c.externalId,
              committeeId: c.committeeId,
              donorName: c.donorName,
              donorType: c.donorType,
              donorEmployer: c.donorEmployer,
              donorOccupation: c.donorOccupation,
              donorCity: c.donorCity,
              donorState: c.donorState,
              donorZip: c.donorZip,
              amount: c.amount,
              date: c.date,
              electionType: c.electionType,
              contributionType: c.contributionType,
              sourceSystem: c.sourceSystem,
            },
          }),
        ),
      );

      const created = data.contributions.filter(
        (c) => !existingSet.has(c.externalId),
      ).length;
      totalProcessed += data.contributions.length;
      totalCreated += created;
      totalUpdated += data.contributions.length - created;
    }

    // Sync expenditures
    if (data.expenditures.length > 0) {
      const externalIds = data.expenditures.map((e) => e.externalId);
      const existing = await this.db.expenditure.findMany({
        where: { externalId: { in: externalIds } },
        select: { externalId: true },
      });
      const existingSet = new Set(
        existing.map((r: ExternalIdRecord) => r.externalId),
      );

      await this.db.$transaction(
        data.expenditures.map((e) =>
          this.db.expenditure.upsert({
            where: { externalId: e.externalId },
            update: {
              committeeId: e.committeeId,
              payeeName: e.payeeName,
              amount: e.amount,
              date: e.date,
              purposeDescription: e.purposeDescription,
              expenditureCode: e.expenditureCode,
              candidateName: e.candidateName,
              propositionTitle: e.propositionTitle,
              supportOrOppose: e.supportOrOppose,
              sourceSystem: e.sourceSystem,
            },
            create: {
              externalId: e.externalId,
              committeeId: e.committeeId,
              payeeName: e.payeeName,
              amount: e.amount,
              date: e.date,
              purposeDescription: e.purposeDescription,
              expenditureCode: e.expenditureCode,
              candidateName: e.candidateName,
              propositionTitle: e.propositionTitle,
              supportOrOppose: e.supportOrOppose,
              sourceSystem: e.sourceSystem,
            },
          }),
        ),
      );

      const created = data.expenditures.filter(
        (e) => !existingSet.has(e.externalId),
      ).length;
      totalProcessed += data.expenditures.length;
      totalCreated += created;
      totalUpdated += data.expenditures.length - created;
    }

    // Sync independent expenditures
    if (data.independentExpenditures.length > 0) {
      const externalIds = data.independentExpenditures.map(
        (ie) => ie.externalId,
      );
      const existing = await this.db.independentExpenditure.findMany({
        where: { externalId: { in: externalIds } },
        select: { externalId: true },
      });
      const existingSet = new Set(
        existing.map((r: ExternalIdRecord) => r.externalId),
      );

      await this.db.$transaction(
        data.independentExpenditures.map((ie) =>
          this.db.independentExpenditure.upsert({
            where: { externalId: ie.externalId },
            update: {
              committeeId: ie.committeeId,
              committeeName: ie.committeeName,
              candidateName: ie.candidateName,
              propositionTitle: ie.propositionTitle,
              supportOrOppose: ie.supportOrOppose,
              amount: ie.amount,
              date: ie.date,
              electionDate: ie.electionDate,
              description: ie.description,
              sourceSystem: ie.sourceSystem,
            },
            create: {
              externalId: ie.externalId,
              committeeId: ie.committeeId,
              committeeName: ie.committeeName,
              candidateName: ie.candidateName,
              propositionTitle: ie.propositionTitle,
              supportOrOppose: ie.supportOrOppose,
              amount: ie.amount,
              date: ie.date,
              electionDate: ie.electionDate,
              description: ie.description,
              sourceSystem: ie.sourceSystem,
            },
          }),
        ),
      );

      const created = data.independentExpenditures.filter(
        (ie) => !existingSet.has(ie.externalId),
      ).length;
      totalProcessed += data.independentExpenditures.length;
      totalCreated += created;
      totalUpdated += data.independentExpenditures.length - created;
    }

    return {
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
    };
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

  /**
   * Discover JSON config files from packages/region-provider/regions/
   * and upsert them into the region_plugins table.
   *
   * Config changes propagate on every restart. The `enabled` flag
   * is never overwritten — it's runtime state managed in the DB.
   * Exception: federal is always enabled on create.
   */
  private async syncRegionConfigs(): Promise<void> {
    const regionsDir =
      process.env.REGION_CONFIGS_DIR ??
      join(process.cwd(), 'packages', 'region-provider', 'regions');

    try {
      const configs = await discoverRegionConfigs(regionsDir);

      for (const file of configs) {
        await this.db.regionPlugin.upsert({
          where: { name: file.name },
          update: {
            displayName: file.displayName,
            description: file.description,
            version: file.version,
            pluginType: 'declarative',
            config: file.config as unknown as Prisma.InputJsonValue,
          },
          create: {
            name: file.name,
            displayName: file.displayName,
            description: file.description,
            version: file.version,
            pluginType: 'declarative',
            // Federal always enabled; local defaults to false
            enabled: file.name === 'federal',
            config: file.config as unknown as Prisma.InputJsonValue,
          },
        });
        this.logger.log(`Synced region config "${file.name}" v${file.version}`);
      }

      if (configs.length > 0) {
        this.logger.log(
          `Auto-synced ${configs.length} region config(s) from ${regionsDir}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to sync region configs from ${regionsDir}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Adapt ExampleRegionProvider (DataFetcher) to IRegionPlugin
   * by adding the required lifecycle methods.
   */
  private createFallbackPlugin(): IRegionPlugin {
    const provider = new ExampleRegionProvider();
    return Object.assign(Object.create(provider), {
      getVersion: () => '0.0.0-fallback',
      initialize: async () => {},
      healthCheck: async () => ({
        healthy: true,
        message: 'Example fallback provider',
        lastCheck: new Date(),
      }),
      destroy: async () => {},
    }) as IRegionPlugin;
  }
}
