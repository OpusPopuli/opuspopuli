import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
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
  getRegionsDir,
  type IPipelineService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import { ServiceInitializationException } from 'src/common/exceptions/app.exceptions';
import {
  resolveConfigPlaceholders,
  batchTransaction,
  type ICache,
  type ISecretsProvider,
  type Proposition,
  type Meeting,
  type Representative,
  type CampaignFinanceResult,
  type MinutesWithActions,
} from '@opuspopuli/common';
import { SECRETS_PROVIDER } from '@opuspopuli/secrets-provider';
import { REGION_CACHE } from './region.tokens';
import { BioGeneratorService } from './bio-generator.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import {
  PropositionFundingService,
  type PropositionFunding,
} from './proposition-funding.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import {
  LegislativeCommitteeService,
  type LegislativeCommitteeDetail,
  type PaginatedLegislativeCommittees as PaginatedLegislativeCommitteesShape,
} from './legislative-committee.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';

/**
 * Minimal interface for data fetching used by sync methods.
 * Satisfied by both RegionProviderService and IRegionPlugin.
 */
interface DataFetcher {
  fetchPropositions(): Promise<Proposition[]>;
  fetchMeetings(): Promise<Meeting[]>;
  fetchRepresentatives(): Promise<Representative[]>;
  fetchCampaignFinance?(
    onBatch?: (items: Record<string, unknown>[]) => Promise<void>,
  ): Promise<CampaignFinanceResult>;
  fetchLegislativeActions?(): Promise<MinutesWithActions[]>;
}
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { RegionInfoModel, DataTypeGQL } from './models/region-info.model';
import {
  PaginatedPropositions,
  PropositionModel,
  PropositionStatusGQL,
} from './models/proposition.model';
import { PaginatedMeetings } from './models/meeting.model';
import {
  PropositionAnalysisClaimModel,
  PropositionAnalysisSectionModel,
} from './models/proposition-analysis.model';
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

// Type aliases for database query results and generic upsert
type ExternalIdRecord = { externalId: string };
type PrismaModelDelegate = {
  findMany(args: unknown): Promise<ExternalIdRecord[]>;
  upsert(args: unknown): Prisma.PrismaPromise<unknown>;
};
type UpsertConfig = {
  records: readonly unknown[];
  model: PrismaModelDelegate;
  fields: string[];
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
  committees: unknown;
  committeesSummary: string | null;
  bio: string | null;
  bioSource: string | null;
  bioClaims: unknown;
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

/**
 * Derive a sortable last-name key from a full name. Used to sort
 * representatives alphabetically by last name regardless of whether the
 * name is stored as "First Last" or "First Middle Last".
 *
 * Strips trailing suffixes (Jr., Sr., III, etc.) so a rep named
 * "Patrick J. Ahrens Jr." sorts under "Ahrens", not "Jr".
 */
/**
 * Extract the trailing numeric segment from an externalId
 * (e.g., `ca-assembly-02` → `"2"`). Done via split+parseInt rather
 * than a regex to avoid backtracking heuristics on patterns like
 * `-0*(\d+)$`.
 */
function deriveDistrictFromExternalId(externalId: string): string | undefined {
  const last = externalId.split('-').at(-1);
  if (!last || !/^\d+$/.test(last)) return undefined;
  return String(Number.parseInt(last, 10));
}

/**
 * Strip leading zeros from a representative externalId's trailing numeric
 * segment (e.g., `ca-assembly-01` → `ca-assembly-1`). IDs whose final
 * segment is not all digits, or whose digits already have no leading
 * zeros, are returned unchanged.
 *
 * Defensive against LLM-generated extraction manifests that produce
 * `regex_replace` patterns with `(\d+)` instead of stripping the leading
 * zero in zero-padded URL/text inputs (e.g., href `/assemblymembers/01`).
 * Two iterations of regions-package hint tightening (#10, #11) failed to
 * stop the LLM from "simplifying" `0?([1-9][0-9]*)` back to `(\d+)`,
 * so canonicalization is enforced at the consumer boundary instead —
 * mirroring how `extractLastName` and `sanitizeDistrict` already
 * normalize other inconsistent extractor outputs in this same path.
 */
export function stripLeadingZerosFromExternalId(externalId: string): string {
  const parts = externalId.split('-');
  const last = parts.at(-1);
  if (!last || !/^\d+$/.test(last)) return externalId;
  const normalized = String(Number.parseInt(last, 10));
  if (normalized === last) return externalId;
  return [...parts.slice(0, -1), normalized].join('-');
}

/**
 * Decide whether a scraped bio string is real content vs junk extracted
 * from the wrong DOM (nav links, news headline blocks, single-word labels).
 *
 * Background: the LLM-generated structural manifest for the CA Senate
 * picks up bio content from per-senator detail sites despite the regions
 * config explicitly discouraging it ("Individual senator sites use
 * different Drupal themes per-senator"). The result is a mix of literal
 * "Home" (the nav link), "Latest News ..." headline blocks, and other
 * non-biographical strings landing in the bio column. When that happens,
 * the BioGenerator's `!r.bio || r.bio.trim() === ''` filter sees the
 * junk as a valid bio and skips AI generation, locking the rep into the
 * junk forever.
 *
 * This function returns true only for bios that look biographical:
 * length ≥ 100 chars and no obvious junk-prefix patterns. Borderline
 * but real bios pass; obvious junk does not.
 */
export function isLikelyValidBio(bio: string | null | undefined): boolean {
  if (!bio) return false;
  const trimmed = bio.trim();
  if (trimmed.length < 100) return false;
  if (/^Home\b/i.test(trimmed)) return false;
  // "Latest News..." headline blocks from per-senator detail sites are
  // junk even when prefixed by a short biographical-looking header
  // ("Senator X Representing District N Latest News ..."). If the
  // phrase appears in the first 100 chars, the rest is news content,
  // not a bio.
  if (/Latest News/i.test(trimmed.slice(0, 100))) return false;
  return true;
}

export function extractLastName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const suffixPattern = /\b(Jr|Sr|II|III|IV|Esq)\.?$/i;
  // Legislative directories often emit "LastName, FirstName [MiddleInitial]"
  // (e.g. "Hadwick, Heather", "Aguiar-Curry, Cecilia M."). Comma form is
  // unambiguous: surname is everything before the first comma — but the
  // suffix can appear before the comma too ("Solache Jr., José Luis"),
  // so strip it from that side as well.
  if (trimmed.includes(',')) {
    const beforeComma = trimmed.slice(0, trimmed.indexOf(',')).trim();
    return beforeComma.replace(suffixPattern, '').trim();
  }
  const withoutSuffix = trimmed.replace(suffixPattern, '').trim();
  const tokens = withoutSuffix.split(/\s+/);
  return tokens.at(-1) ?? trimmed;
}

/**
 * Cast a Prisma proposition row into the GraphQL-shaped object. Converts
 * DB nulls to GraphQL undefined and unpacks JSONB columns that are stored
 * as `unknown` at the Prisma type level. Used by both the list (plural)
 * getter and the single-record resolver.
 */
export function mapPropositionRecord(
  item: PropositionRecord,
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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

@Injectable()
export class RegionDomainService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegionDomainService.name, {
    timestamp: true,
  });
  private regionService!: RegionProviderService;

  constructor(
    private readonly pluginLoader: PluginLoaderService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly db: DbService,
    @Inject(REGION_CACHE) private readonly cache: ICache<string>,
    @Optional()
    @Inject('SCRAPING_PIPELINE')
    private readonly pipeline?: IPipelineService,
    @Optional()
    @Inject(SECRETS_PROVIDER)
    private readonly secretsProvider?: ISecretsProvider,
    @Optional() private readonly bioGenerator?: BioGeneratorService,
    @Optional()
    private readonly committeeSummaryGenerator?: CommitteeSummaryGeneratorService,
    @Optional()
    private readonly propositionAnalysis?: PropositionAnalysisService,
    @Optional()
    private readonly propositionFinanceLinker?: PropositionFinanceLinkerService,
    @Optional()
    private readonly propositionFunding?: PropositionFundingService,
    @Optional()
    private readonly legislativeCommitteeLinker?: LegislativeCommitteeLinkerService,
    @Optional()
    private readonly legislativeCommittees?: LegislativeCommitteeService,
    @Optional()
    private readonly legislativeCommitteeDescriptions?: LegislativeCommitteeDescriptionGeneratorService,
    @Optional()
    private readonly legislativeActionLinker?: LegislativeActionLinkerService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.cache.destroy();
  }

  /**
   * Resolve API keys from Supabase Vault and set as environment variables.
   * Falls back silently to existing env vars if Vault is unavailable.
   * This runs before plugin loading so API keys are available when
   * the scraping pipeline's ApiIngestHandler reads process.env.
   */
  private async resolveApiKeysFromVault(): Promise<void> {
    if (!this.secretsProvider) return;

    const apiKeyNames = ['FEC_API_KEY'];

    for (const keyName of apiKeyNames) {
      // Skip if already set in environment
      if (process.env[keyName]) continue;

      try {
        const secret = await this.secretsProvider.getSecret(keyName);
        if (secret) {
          process.env[keyName] = secret;
          this.logger.log(`Resolved ${keyName} from secrets vault`);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to resolve ${keyName} from vault: ${(error as Error).message}. Falling back to env var.`,
        );
      }
    }
  }

  /**
   * Load region plugins at startup:
   * 1. Sync JSON config files to the database
   * 2. Always load the federal plugin (FEC data)
   * 3. Load the enabled local plugin (state civic data)
   * Falls back to ExampleRegionProvider if no local plugin is configured.
   */
  async onModuleInit(): Promise<void> {
    await this.resolveApiKeysFromVault();
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
      throw new ServiceInitializationException(
        'No local region plugin available after initialization',
      );
    }

    this.regionService = new RegionProviderService(localPlugin);
    const info = this.regionService.getRegionInfo();
    this.logger.log(
      `RegionDomainService initialized — local: ${this.regionService.getProviderName()} (${info.name}), ` +
        `federal: ${this.pluginRegistry.getFederal() ? 'loaded' : 'not loaded'}`,
    );
  }

  /**
   * Cache-through helper: returns cached result or executes query and caches it.
   */
  private async cachedQuery<T>(
    key: string,
    queryFn: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.cache.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    const result = await queryFn();
    await this.cache.set(key, JSON.stringify(result));
    return result;
  }

  /**
   * Invalidate all cache keys matching a prefix.
   */
  private async invalidateCache(prefix: string): Promise<void> {
    const allKeys = await this.cache.keys();
    const matching = allKeys.filter((k) => k.startsWith(prefix));
    for (const k of matching) {
      await this.cache.delete(k);
    }
    if (matching.length > 0) {
      this.logger.log(
        `Invalidated ${matching.length} cache key(s) with prefix "${prefix}"`,
      );
    }
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
   * Sync data types from all loaded plugins (federal + local).
   * When dataTypes is provided, only those types are synced.
   */
  async syncAll(dataTypes?: string[], maxReps?: number): Promise<SyncResult[]> {
    this.logger.log(
      dataTypes
        ? `Starting data sync for: ${dataTypes.join(', ')}`
        : 'Starting full data sync',
    );
    const results: SyncResult[] = [];

    for (const registered of this.pluginRegistry.getAll()) {
      const supported = registered.instance.getSupportedDataTypes();
      const filtered = dataTypes
        ? supported.filter((dt) => dataTypes.includes(dt))
        : supported;

      for (const dataType of filtered) {
        try {
          const result = await this.syncDataTypeFrom(
            registered.instance,
            registered.name,
            dataType,
            maxReps,
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
    maxReps?: number,
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
      [DataType.REPRESENTATIVES]: () =>
        this.syncRepresentatives(provider, maxReps),
      [DataType.CAMPAIGN_FINANCE]: () => this.syncCampaignFinance(provider),
      [DataType.LEGISLATIVE_ACTIONS]: () =>
        this.syncLegislativeActions(provider),
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

    // Batch upsert all propositions in chunked transactions (#476)
    await batchTransaction(
      this.db,
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

    // Invalidate cached proposition queries (#459)
    await this.invalidateCache('propositions:');

    // Generate AI analysis for any proposition with fullText but no
    // analysis yet. DB-driven so it picks up newly ingested PDFs as well
    // as past rows missed by earlier sync cycles. Fire-and-forget in the
    // sense that failures are logged but don't abort the sync.
    if (this.propositionAnalysis) {
      try {
        await this.propositionAnalysis.generateMissing();
      } catch (error) {
        this.logger.warn(
          `Proposition analysis post-sync pass failed: ${(error as Error).message}`,
        );
      }
    }

    const created = propositions.filter(
      (p) => !existingExternalIds.has(p.externalId),
    ).length;
    const updated = propositions.filter((p) =>
      existingExternalIds.has(p.externalId),
    ).length;

    return { processed: propositions.length, created, updated };
  }

  /**
   * Regenerate AI analysis for a single proposition. Admin-invoked via the
   * regeneratePropositionAnalysis mutation; also used by the backfill
   * script for forced reruns.
   */
  async regeneratePropositionAnalysis(id: string): Promise<boolean> {
    if (!this.propositionAnalysis) return false;
    const result = await this.propositionAnalysis.generate(id, true);
    if (result) {
      await this.invalidateCache('propositions:');
    }
    return result;
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

    // Batch upsert all meetings in chunked transactions (#476)
    await batchTransaction(
      this.db,
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

    // Invalidate cached meeting queries (#459)
    await this.invalidateCache('meetings:');

    const created = meetings.filter(
      (m) => !existingExternalIds.has(m.externalId),
    ).length;
    const updated = meetings.filter((m) =>
      existingExternalIds.has(m.externalId),
    ).length;

    return { processed: meetings.length, created, updated };
  }

  /**
   * Sync `Minutes` documents from `legislative_actions` data sources
   * (CA Assembly daily journals etc.) and run the post-sync linker
   * pass. Two phases:
   *
   *   1. Upsert each MinutesWithActions.minutes row by externalId.
   *      Revisions (`revisionSeq>0`) supersede their predecessors:
   *      after the new row is upserted, all rows for the same
   *      (body, date) with a lower revisionSeq get isActive=false.
   *
   *   2. Hand the inserted minutes ids to LegislativeActionLinkerService,
   *      which mines rawText to produce LegislativeAction rows with
   *      passage offsets attributing the actions to representatives,
   *      propositions, and committees.
   *
   * Issue #665.
   */
  private async syncLegislativeActions(
    provider: DataFetcher = this.regionService,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    if (!provider.fetchLegislativeActions) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const bundles = await provider.fetchLegislativeActions();
    if (bundles.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const externalIds = bundles.map((b) => b.minutes.externalId);
    const existingRecords = await this.db.minutes.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingExternalIds = new Set(
      existingRecords.map((r: ExternalIdRecord) => r.externalId),
    );

    const upsertedIds: string[] = [];
    for (const { minutes } of bundles) {
      const row = await this.db.minutes.upsert({
        where: { externalId: minutes.externalId },
        update: {
          body: minutes.body,
          date: minutes.date,
          revisionSeq: minutes.revisionSeq,
          isActive: true,
          pageCount: minutes.pageCount,
          sourceUrl: minutes.sourceUrl,
          rawText: minutes.rawText,
          parsedAt: minutes.parsedAt ?? new Date(),
        },
        create: {
          externalId: minutes.externalId,
          body: minutes.body,
          date: minutes.date,
          revisionSeq: minutes.revisionSeq,
          isActive: true,
          pageCount: minutes.pageCount,
          sourceUrl: minutes.sourceUrl,
          rawText: minutes.rawText,
          parsedAt: minutes.parsedAt ?? new Date(),
        },
        select: { id: true },
      });
      upsertedIds.push(row.id);

      // Supersede older revisions for the same (body, date).
      if (minutes.revisionSeq > 0) {
        await this.db.minutes.updateMany({
          where: {
            body: minutes.body,
            date: minutes.date,
            revisionSeq: { lt: minutes.revisionSeq },
          },
          data: { isActive: false },
        });
      }
    }

    // Run the deterministic linker over the freshly-upserted rows.
    // Optional injection: when the linker isn't bound, Minutes are
    // still persisted but no LegislativeAction rows are produced.
    if (upsertedIds.length > 0 && this.legislativeActionLinker) {
      await this.legislativeActionLinker.linkMinutes(upsertedIds);
    }

    const created = bundles.filter(
      (b) => !existingExternalIds.has(b.minutes.externalId),
    ).length;
    const updated = bundles.filter((b) =>
      existingExternalIds.has(b.minutes.externalId),
    ).length;

    return { processed: bundles.length, created, updated };
  }

  /**
   * Sync representatives using bulk upsert
   *
   * PERFORMANCE: Uses batch upsert instead of N+1 queries
   * This reduces database round trips from O(2n) to O(2) queries
   * @see https://github.com/OpusPopuli/opuspopuli/issues/197
   */
  /**
   * Defensive guard against garbage `district` values from flaky LLM-
   * generated manifests. California reps encode district numerically
   * in `externalId` (e.g., `ca-assembly-02`), so when the scrape's
   * district field doesn't look numeric we derive the correct value
   * from externalId. Without this, a manifest that captures a label
   * node ("District:") instead of the number clobbers the DB and
   * breaks address-based rep matching for every voter in the state.
   */
  private sanitizeDistrict(rep: Representative): string {
    const raw = (rep.district ?? '').trim();
    // Numeric district: canonicalize by stripping leading zeros so the
    // stored district matches the externalId form (`ca-assembly-1`, not
    // `ca-assembly-01`). The CA Assembly listing emits `01`, `02`, ... in
    // the district field and we strip the same way externalId does.
    if (/^\d+$/.test(raw)) return String(Number.parseInt(raw, 10));
    const derived = deriveDistrictFromExternalId(rep.externalId);
    if (derived !== undefined) {
      this.logger.warn(
        `Sanitized district for ${rep.name} (${rep.externalId}): scraped value "${raw}" is not numeric, using externalId-derived "${derived}"`,
      );
      return derived;
    }
    if (raw) {
      this.logger.warn(
        `Non-numeric district "${raw}" for ${rep.name} (${rep.externalId}) and no numeric suffix to fall back on; keeping raw value`,
      );
    }
    return raw;
  }

  /**
   * Pre-upsert normalization for a single Representative record:
   *   - canonicalize externalId (strip zero-padding from the trailing digit run)
   *   - drop bios that look like extraction junk (nav-link "Home" text,
   *     "Latest News" headline blocks from mismatched-theme senator sites);
   *     nulling here makes the BioGenerator's `!r.bio || r.bio.trim() === ''`
   *     filter pick them up and replace with an AI-generated bio
   *   - mark provenance for bios that arrived from the scrape (covers the
   *     case where BioGenerator returns early because LLM/prompt deps are
   *     unwired and would otherwise leave scraped bios with a null bioSource)
   *
   * Idempotent with BioGenerator's own scraped-bio marking pass.
   */
  private normalizeRep(r: Representative): void {
    r.externalId = stripLeadingZerosFromExternalId(r.externalId);
    if (r.bio && !isLikelyValidBio(r.bio)) {
      this.logger.warn(
        `Discarding junk bio for ${r.externalId} (${r.bio.length} chars): ${r.bio.slice(0, 60)}…`,
      );
      r.bio = undefined;
      r.bioSource = undefined;
    }
    if (r.bio && !r.bioSource) {
      r.bioSource = 'scraped';
    }
  }

  private async syncRepresentatives(
    provider: DataFetcher = this.regionService,
    maxReps?: number,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    const reps = await provider.fetchRepresentatives();
    if (reps.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    for (const r of reps) {
      this.normalizeRep(r);
    }

    // Enrich with AI-generated bios where missing (scraped bios are preserved)
    if (this.bioGenerator) {
      await this.bioGenerator.enrichBios(reps, maxReps);
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

    // Batch upsert all representatives in chunked transactions (#476)
    await batchTransaction(
      this.db,
      reps.map((rep) => {
        const lastName = extractLastName(rep.name);
        const district = this.sanitizeDistrict(rep);
        return this.db.representative.upsert({
          where: { externalId: rep.externalId },
          // On UPDATE: `undefined` tells Prisma to skip a field and
          // preserve the existing DB value. A null from the scrape
          // (field present in the extractor output but unset for this
          // rep) would otherwise clobber previously-enriched data —
          // e.g., wiping an AI-generated bio when the Assembly detail
          // scrape stops returning a bio field. Convert null→undefined
          // for every optional enrichment field.
          update: {
            name: rep.name,
            lastName,
            chamber: rep.chamber,
            district,
            party: rep.party,
            photoUrl: rep.photoUrl ?? undefined,
            contactInfo: (rep.contactInfo as object | null) ?? undefined,
            committees: (rep.committees as object[] | null) ?? undefined,
            committeesSummary: rep.committeesSummary ?? undefined,
            bio: rep.bio ?? undefined,
            bioSource: rep.bioSource ?? undefined,
            bioClaims: (rep.bioClaims as object[] | null) ?? undefined,
          },
          create: {
            externalId: rep.externalId,
            name: rep.name,
            lastName,
            chamber: rep.chamber,
            district,
            party: rep.party,
            photoUrl: rep.photoUrl,
            contactInfo: rep.contactInfo as object | undefined,
            committees: rep.committees as object[] | undefined,
            committeesSummary: rep.committeesSummary,
            bio: rep.bio,
            bioSource: rep.bioSource,
            bioClaims: rep.bioClaims as object[] | undefined,
          },
        });
      }),
    );

    // Invalidate cached representative queries (#459)
    await this.invalidateCache('representatives:');

    // Post-upsert: generate the AI committee-assignment preamble for any
    // reps that have committees but no summary yet. DB-driven so it runs
    // even when a given sync cycle only refreshes part of the roster
    // (e.g., Senate-only when Assembly scrape breaks). See #594 Task 4.
    if (this.committeeSummaryGenerator) {
      await this.committeeSummaryGenerator.generateMissingSummaries(maxReps);
    }

    // Materialize the rep ↔ legislative-committee graph from the
    // Representative.committees JSONB. Idempotent — re-running over
    // unchanged JSON produces zero new rows. Same shape as the
    // proposition-finance linker that runs after campaign-finance sync.
    if (this.legislativeCommitteeLinker) {
      try {
        await this.legislativeCommitteeLinker.linkAll();
      } catch (error) {
        this.logger.warn(
          `Legislative committee linker failed: ${(error as Error).message}`,
        );
      }
    }

    // Fill in AI-generated 2-3 sentence descriptions for any committees
    // (just-created or pre-existing) that don't have one yet. Runs after
    // the linker so newly-materialized committees get described in the
    // same sync cycle. Mirrors CommitteeSummaryGenerator's resilience —
    // catches inside the service so an LLM/prompt-service flake never
    // blocks the rest of the sync.
    if (this.legislativeCommitteeDescriptions) {
      try {
        await this.legislativeCommitteeDescriptions.generateMissingDescriptions(
          maxReps,
        );
      } catch (error) {
        this.logger.warn(
          `Legislative committee description generation failed: ${(error as Error).message}`,
        );
      }
    }

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
  /**
   * Auto-create stub committee records for any committee IDs referenced by
   * contributions/expenditures/IEs that don't exist yet. This prevents FK
   * violations. Also replaces external committee IDs with DB UUIDs.
   */
  private async ensureCommitteeStubs(
    data: CampaignFinanceResult,
  ): Promise<void> {
    // Build the union of every committee externalId referenced by any
    // record in this batch, AND remember the sourceSystem of the first
    // record we saw referencing it. Each finance record carries its own
    // `sourceSystem`; using that for the stub avoids the #634 bug where
    // every CalAccess-referenced stub was mislabeled as 'fec'.
    //
    // First-wins on the rare case of a single committee referenced by
    // records from both source systems in the same batch — in practice
    // a given committee is sourced from one system, so collisions are
    // theoretical. The chosen sourceSystem only labels the stub; the
    // real committee row created later by direct ingestion will UPDATE
    // the stub via upsert and set the authoritative value.
    const referencedIds = new Set<string>();
    const sourceSystemByExternalId = new Map<string, 'cal_access' | 'fec'>();
    const noteReference = (
      committeeId: string | undefined | null,
      sourceSystem: 'cal_access' | 'fec',
    ) => {
      if (!committeeId) return;
      referencedIds.add(committeeId);
      if (!sourceSystemByExternalId.has(committeeId)) {
        sourceSystemByExternalId.set(committeeId, sourceSystem);
      }
    };
    for (const c of data.contributions)
      noteReference(c.committeeId, c.sourceSystem);
    for (const e of data.expenditures)
      noteReference(e.committeeId, e.sourceSystem);
    for (const ie of data.independentExpenditures) {
      noteReference(ie.committeeId, ie.sourceSystem);
    }

    if (referencedIds.size === 0) return;

    const existing = await this.db.committee.findMany({
      where: { externalId: { in: [...referencedIds] } },
      select: { externalId: true, id: true },
    });
    const existingMap = new Map(
      existing.map((c: { externalId: string; id: string }) => [
        c.externalId,
        c.id,
      ]),
    );

    const missingIds = [...referencedIds].filter((id) => !existingMap.has(id));

    if (missingIds.length > 0) {
      this.logger.log(
        `Creating ${missingIds.length} stub committee records for FK references`,
      );
      await batchTransaction(
        this.db,
        missingIds.map((externalId) =>
          this.db.committee.create({
            data: {
              externalId,
              name: externalId,
              type: 'OTHER',
              status: 'active',
              // Default to 'fec' only if somehow no record carrying this
              // externalId had a sourceSystem — shouldn't happen given the
              // reference-walking above, but the fallback keeps the column
              // non-null without breaking the (#634) fix in the common path.
              sourceSystem: sourceSystemByExternalId.get(externalId) ?? 'fec',
            },
          }),
        ),
      );
    }

    // Build lookup from externalId → DB UUID for FK resolution
    const allCommittees = await this.db.committee.findMany({
      where: { externalId: { in: [...referencedIds] } },
      select: { externalId: true, id: true },
    });
    const idMap = new Map(
      allCommittees.map((c: { externalId: string; id: string }) => [
        c.externalId,
        c.id,
      ]),
    );

    for (const c of data.contributions) {
      c.committeeId = idMap.get(c.committeeId) ?? c.committeeId;
    }
    for (const e of data.expenditures) {
      e.committeeId = idMap.get(e.committeeId) ?? e.committeeId;
    }
    for (const ie of data.independentExpenditures) {
      ie.committeeId = idMap.get(ie.committeeId) ?? ie.committeeId;
    }
  }

  private async syncCampaignFinance(provider: DataFetcher): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    if (!provider.fetchCampaignFinance) {
      return { processed: 0, created: 0, updated: 0 };
    }

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    // Batch callback: sort each batch by record type and upsert immediately
    const onBatch = async (items: Record<string, unknown>[]) => {
      const batchData = this.sortCampaignFinanceItems(items);
      await this.ensureCommitteeStubs(batchData);
      const result = await this.upsertCampaignFinanceBatch(batchData);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
    };

    const data = await provider.fetchCampaignFinance(onBatch);

    // Handle any non-batched items (from API sources or small files)
    if (
      data.contributions.length > 0 ||
      data.expenditures.length > 0 ||
      data.independentExpenditures.length > 0 ||
      data.committeeMeasureFilings.length > 0
    ) {
      await this.ensureCommitteeStubs(data);
      const result = await this.upsertCampaignFinanceBatch(data);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
    }

    // Resolve committee↔proposition links from CVR2 + propositionTitle
    // strings. Fire-and-forget: the linker's own errors should not fail
    // the sync since the raw data is already persisted and a later run
    // can re-resolve. Mirrors the post-sync hook pattern from
    // syncPropositions → propositionAnalysis.generateMissing().
    if (this.propositionFinanceLinker) {
      try {
        await this.propositionFinanceLinker.linkAll();
      } catch (error) {
        this.logger.warn(
          `Proposition finance linker failed: ${(error as Error).message}`,
        );
      }
    }

    return {
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
    };
  }

  /**
   * Aggregate funding for a single proposition. Delegates to the funding
   * service (which handles caching). Returns null when the funding service
   * isn't wired (e.g. some test contexts).
   */
  async getPropositionFunding(
    propositionId: string,
  ): Promise<PropositionFunding | null> {
    if (!this.propositionFunding) return null;
    return this.propositionFunding.getFunding(propositionId);
  }

  /**
   * Sort a flat array of campaign finance items into typed buckets.
   * The CVR2 (committee↔measure filing) discriminator runs before the
   * generic "sourceSystem + type" committee check because CVR2 records
   * also carry a sourceSystem.
   */
  private sortCampaignFinanceItems(
    items: Record<string, unknown>[],
  ): CampaignFinanceResult {
    const committees: CampaignFinanceResult['committees'] = [];
    const contributions: CampaignFinanceResult['contributions'] = [];
    const expenditures: CampaignFinanceResult['expenditures'] = [];
    const independentExpenditures: CampaignFinanceResult['independentExpenditures'] =
      [];
    const committeeMeasureFilings: CampaignFinanceResult['committeeMeasureFilings'] =
      [];

    for (const rec of items) {
      if ('donorName' in rec && 'amount' in rec) {
        contributions.push(
          rec as unknown as CampaignFinanceResult['contributions'][0],
        );
      } else if ('payeeName' in rec && 'amount' in rec) {
        expenditures.push(
          rec as unknown as CampaignFinanceResult['expenditures'][0],
        );
      } else if ('supportOrOppose' in rec && 'committeeName' in rec) {
        independentExpenditures.push(
          rec as unknown as CampaignFinanceResult['independentExpenditures'][0],
        );
      } else if (
        'filingId' in rec &&
        ('ballotName' in rec || 'ballotNumber' in rec)
      ) {
        committeeMeasureFilings.push(
          rec as unknown as CampaignFinanceResult['committeeMeasureFilings'][0],
        );
      } else if ('sourceSystem' in rec && 'type' in rec) {
        committees.push(
          rec as unknown as CampaignFinanceResult['committees'][0],
        );
      }
    }

    return {
      committees,
      contributions,
      expenditures,
      independentExpenditures,
      committeeMeasureFilings,
    };
  }

  /**
   * Upsert a batch of campaign finance records to the database.
   */
  private async upsertCampaignFinanceBatch(
    data: CampaignFinanceResult,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const upsertConfigs: UpsertConfig[] = [
      {
        records: data.contributions,
        model: this.db.contribution,
        fields: [
          'committeeId',
          'donorName',
          'donorType',
          'donorEmployer',
          'donorOccupation',
          'donorCity',
          'donorState',
          'donorZip',
          'amount',
          'date',
          'electionType',
          'contributionType',
          'sourceSystem',
        ],
      },
      {
        records: data.expenditures,
        model: this.db.expenditure,
        fields: [
          'committeeId',
          'payeeName',
          'amount',
          'date',
          'purposeDescription',
          'expenditureCode',
          'candidateName',
          'propositionTitle',
          'supportOrOppose',
          'sourceSystem',
        ],
      },
      {
        records: data.independentExpenditures,
        model: this.db.independentExpenditure,
        fields: [
          'committeeId',
          'committeeName',
          'candidateName',
          'propositionTitle',
          'supportOrOppose',
          'amount',
          'date',
          'electionDate',
          'description',
          'sourceSystem',
        ],
      },
      {
        records: data.committeeMeasureFilings,
        model: this.db.cvr2Filing,
        fields: [
          'filingId',
          'ballotName',
          'ballotNumber',
          'ballotJurisdiction',
          'supportOrOppose',
          'sourceSystem',
        ],
      },
    ];

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const config of upsertConfigs) {
      if (config.records.length === 0) continue;
      const result = await this.upsertRecordsByFields(config);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
    }

    return {
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
    };
  }

  /**
   * Generic upsert: find existing by externalId, batch upsert, return counts.
   * Uses a field-name list to pick values from records, avoiding per-model callbacks.
   */
  private async upsertRecordsByFields(
    config: UpsertConfig,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const { model, fields } = config;
    const rows = config.records as Record<string, unknown>[];
    const externalIds = rows.map((r) => r.externalId as string);

    const existing = await model.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingSet = new Set(
      existing.map((r: ExternalIdRecord) => r.externalId),
    );

    const pick = (r: Record<string, unknown>) =>
      Object.fromEntries(fields.map((f: string) => [f, r[f]]));

    await batchTransaction(
      this.db,
      rows.map((r) =>
        model.upsert({
          where: { externalId: r.externalId as string },
          update: pick(r),
          create: { externalId: r.externalId, ...pick(r) },
        }),
      ),
    );

    const created = rows.filter(
      (r) => !existingSet.has(r.externalId as string),
    ).length;
    return {
      processed: rows.length,
      created,
      updated: rows.length - created,
    };
  }

  /**
   * Get propositions with pagination
   */
  async getPropositions(
    skip: number = 0,
    take: number = 10,
  ): Promise<PaginatedPropositions> {
    return this.cachedQuery(`propositions:${skip}:${take}`, async () => {
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
        items: paginatedItems.map((item: PropositionRecord) =>
          mapPropositionRecord(item),
        ),
        total,
        hasMore,
      };
    });
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
    return this.cachedQuery(`meetings:${skip}:${take}`, async () => {
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
    });
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
    return this.cachedQuery(
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

        // Cast database types to GraphQL types
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

  /**
   * Get a single representative by ID
   */
  async getRepresentative(id: string) {
    return this.db.representative.findUnique({ where: { id } });
  }

  /**
   * Find representatives matching a user's civic districts.
   * Normalizes district number formats between Census API output
   * and scraped representative data.
   */
  async getRepresentativesByDistricts(
    congressionalDistrict?: string,
    stateSenatorialDistrict?: string,
    stateAssemblyDistrict?: string,
  ): Promise<RepresentativeRecord[]> {
    // The CA scrape stores Senate districts zero-padded ("02") but Assembly
    // unpadded ("2"). Match against BOTH forms for both chambers so a future
    // drift in either direction doesn't silently drop matches again.
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

  /**
   * Extract and zero-pad a district number from Census format.
   * "Congressional District 2" → "02"
   * "State Senate District 12" → "12"
   * "Assembly District 5" → "05"
   */
  private extractDistrictNumber(districtString: string): string | null {
    const match = districtString.match(/(\d+)/);
    if (!match) return null;
    return match[1].padStart(2, '0');
  }

  // ==========================================
  // LEGISLATIVE COMMITTEE GETTERS
  // ==========================================

  async listLegislativeCommittees(args: {
    skip: number;
    take: number;
    chamber?: string;
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

  /**
   * Resolve each entry in a rep's `committees` JSONB to the matching
   * `LegislativeCommittee.id` when one exists. Used by the rep query
   * resolver so the frontend can render each committee row as a link to
   * the committee detail page without duplicating normalization logic.
   *
   * Quietly returns `[]` (effectively a no-op) when the linker isn't
   * available — the rep query still works, the names just stay as plain
   * text. Same defensive shape as the linker itself.
   */
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

  // ==========================================
  // CAMPAIGN FINANCE GETTERS
  // ==========================================

  /**
   * Get committees with pagination
   */
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

  /**
   * Get a single committee by ID
   */
  async getCommittee(id: string) {
    return this.db.committee.findUnique({ where: { id } });
  }

  /**
   * Get contributions with pagination
   */
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

  /**
   * Get a single contribution by ID
   */
  async getContribution(id: string) {
    return this.db.contribution.findUnique({ where: { id } });
  }

  /**
   * Get expenditures with pagination
   */
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

  /**
   * Get a single expenditure by ID
   */
  async getExpenditure(id: string) {
    return this.db.expenditure.findUnique({ where: { id } });
  }

  /**
   * Get independent expenditures with pagination
   */
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

  /**
   * Get a single independent expenditure by ID
   */
  async getIndependentExpenditure(id: string) {
    return this.db.independentExpenditure.findUnique({ where: { id } });
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
    const regionsDir = process.env.REGION_CONFIGS_DIR ?? getRegionsDir();

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
