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
  SyncDepth,
  SyncResult,
  PluginLoaderService,
  PluginRegistryService,
  DeclarativeRegionPlugin,
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
  extractJsonObjectSlice,
  type ISecretsProvider,
  type Proposition,
  type Meeting,
  type Representative,
  type CampaignFinanceResult,
  type MinutesWithActions,
  type ILLMProvider,
  type DataSourceConfig,
  type DeclarativeRegionConfig,
  type Bill,
} from '@opuspopuli/common';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { SECRETS_PROVIDER } from '@opuspopuli/secrets-provider';
import { BioGeneratorService } from './bio-generator.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { LegislativeCommitteeService } from './legislative-committee.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';
import { HostThrottle, fetchTextWithRetry } from './resilient-fetch';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  isBillDead,
  isBillActive,
  computeActiveCaSessionYears,
} from './bill-lifecycle';
import { RegionInfoModel, DataTypeGQL } from './models/region-info.model';
import { RegionCacheService } from './region-cache.service';
import {
  stripLeadingZerosFromExternalId,
  isLikelyValidBio,
  extractLastName,
} from './region.service';

// ─── Type aliases (sync-local, not exported) ─────────────────────────────────

type ExternalIdRecord = { externalId: string };

/** Compiled lifecycle stage pattern used for bill status resolution. */
interface StagePattern {
  stageId: string;
  regex: RegExp;
}

/** Minimal Bill row shape needed by the inner sync-loop skip checks.
 *  Loaded once per region via `loadBillSkipMetadata` to avoid N+1 reads. */
interface BillSkipRecord {
  id: string;
  externalId: string;
  sourcePublishedAt: Date | null;
  lastAction: string | null;
  lastActionDate: Date | null;
  needsStatusRecheck: boolean;
}

/** Region plugin row shape returned by list/lookup queries. */
type RegionPluginRow = {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  enabled: boolean;
  parentRegionId?: string;
  fipsCode?: string;
};

function toRegionPluginRow(r: {
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
 * Minimal interface for data fetching used by sync methods.
 * Satisfied by both RegionProviderService and IRegionPlugin.
 */
interface DataFetcher {
  fetchPropositions(pipelineJobId?: string): Promise<Proposition[]>;
  fetchMeetings(pipelineJobId?: string): Promise<Meeting[]>;
  fetchRepresentatives(): Promise<Representative[]>;
  fetchCampaignFinance?(
    onBatch?: (items: Record<string, unknown>[]) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<CampaignFinanceResult>;
  fetchMeetingMinutes?(): Promise<MinutesWithActions[]>;
  getName?(): string;
  getDataSources?(dataType?: DataType): DataSourceConfig[];
}

type PrismaModelDelegate = {
  findMany(args: unknown): Promise<ExternalIdRecord[]>;
  upsert(args: unknown): Prisma.PrismaPromise<unknown>;
};
type UpsertConfig = {
  records: readonly unknown[];
  model: PrismaModelDelegate;
  fields: string[];
};
type CommitteeRecord = {
  externalId: string;
  id: string;
};

/**
 * Shape we expect from the bill-analysis LLM response. Everything is
 * optional at the runtime boundary — the LLM may drop fields, and the
 * `skip` sentinel short-circuits the rest. Stored verbatim in
 * `Bill.aiSummary` as JSONB. Consumers (ranking pipeline #743, briefing
 * UI #744) read via the typed GraphQL field added in #741.
 */
interface BillAiSummaryShape {
  plainEnglishSummary?: string;
  topics?: string[];
  whoItAffects?: string[];
  fiscalImpact?: { level?: string; summary?: string };
  stakeholderImpact?: string;
  /** LLM sentinel: input was blank / garbled / not a bill. */
  skip?: boolean;
}

/**
 * Subset of Bill columns required by the enrichment loop. Derived from
 * the Prisma model so the type stays in sync with the schema — adding
 * a new column to Bill doesn't quietly break the candidate fetch.
 */
type BillEnrichmentCandidate = Prisma.BillGetPayload<{
  select: {
    id: true;
    regionId: true;
    billNumber: true;
    sessionYear: true;
    title: true;
    subject: true;
    status: true;
    authorName: true;
    fiscalImpact: true;
    fullTextUrl: true;
  };
}>;

// State-level rows (parentRegionId IS NULL) sort before county rows so the
// primary plugin is always a state plugin when one is available.
function comparePluginRows(
  a: { name: string; parentRegionId: string | null },
  b: { name: string; parentRegionId: string | null },
): number {
  if (!a.parentRegionId && b.parentRegionId) return -1;
  if (a.parentRegionId && !b.parentRegionId) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * RegionSyncService — owns all data-synchronisation logic extracted from
 * the monolithic RegionDomainService (issue DEBT-030). Implements
 * OnModuleInit / OnModuleDestroy so it can perform plugin loading and
 * cache teardown just as the original class did.
 */
@Injectable()
export class RegionSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegionSyncService.name, {
    timestamp: true,
  });
  private regionService!: RegionProviderService;
  private pluginRegionName: string | undefined;
  private pluginNormalizeDistrict = false;
  private pluginBioNoisePatterns: RegExp[] = [];
  /** Per-host fetch throttle shared across all syncs in this process.
   *  Per-source `rateLimitOverride` values are applied to the relevant
   *  hostname by sync orchestrators before they start their loops. */
  private readonly hostThrottle = new HostThrottle(1000);

  constructor(
    private readonly pluginLoader: PluginLoaderService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly db: DbService,
    private readonly cacheService: RegionCacheService,
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
    private readonly legislativeCommitteeLinker?: LegislativeCommitteeLinkerService,
    @Optional()
    private readonly legislativeCommittees?: LegislativeCommitteeService,
    @Optional()
    private readonly legislativeCommitteeDescriptions?: LegislativeCommitteeDescriptionGeneratorService,
    @Optional()
    private readonly legislativeActionLinker?: LegislativeActionLinkerService,
    @Optional() private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    private readonly llm?: ILLMProvider,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.cacheService.destroy();
  }

  /**
   * Resolve API keys from Supabase Vault and set as environment variables.
   * Falls back silently to existing env vars if Vault is unavailable.
   */
  private async resolveApiKeysFromVault(): Promise<void> {
    if (!this.secretsProvider) return;

    const apiKeyNames = ['FEC_API_KEY'];

    for (const keyName of apiKeyNames) {
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
   * Load region plugins at startup.
   */
  async onModuleInit(): Promise<void> {
    await this.resolveApiKeysFromVault();
    await this.syncRegionConfigs();
    const { localConfigRow, allLocalConfigRows } =
      await this.fetchLocalPluginConfigs();

    const stateCode = (
      localConfigRow?.config as Record<string, unknown> | undefined
    )?.stateCode as string | undefined;

    await this.initFederalPlugin(stateCode);
    await this.reloadActiveLocalPlugin(allLocalConfigRows, localConfigRow);
  }

  /**
   * Re-read the `region_plugins` table and swap the in-memory active local
   * plugin to match. Called from `setRegionPluginEnabled` (so admin toggles
   * take effect without a service restart) and from the public
   * `refreshActiveLocalPlugin` recovery mutation. See #796 for the failure
   * mode this prevents.
   *
   * Federal plugin is NOT refreshed here — if the toggled plugin changed
   * the federal `stateCode`, the federal placeholders will still hold the
   * boot-time value. That's a known limitation; restart the service if
   * federal needs to re-resolve.
   */
  async refreshActiveLocalPlugin(): Promise<void> {
    const { localConfigRow, allLocalConfigRows } =
      await this.fetchLocalPluginConfigs();
    await this.reloadActiveLocalPlugin(allLocalConfigRows, localConfigRow);
  }

  private async fetchLocalPluginConfigs(): Promise<{
    localConfigRow: { config: unknown } | undefined;
    allLocalConfigRows: {
      name: string;
      config: unknown;
      parentRegionId: string | null;
    }[];
  }> {
    const allLocalConfigRows = await this.db.regionPlugin.findMany({
      where: { enabled: true, name: { not: 'federal' } },
    });
    // State-level plugins (parentRegionId IS NULL) first so the primary plugin
    // is always a state plugin when one is available.
    allLocalConfigRows.sort(comparePluginRows);
    const localConfigRow =
      allLocalConfigRows.find((r) => !r.parentRegionId) ??
      allLocalConfigRows[0];
    return { localConfigRow, allLocalConfigRows };
  }

  private async reloadActiveLocalPlugin(
    allLocalConfigRows: {
      name: string;
      config: unknown;
      parentRegionId: string | null;
    }[],
    localConfigRow: { config: unknown } | undefined,
  ): Promise<void> {
    // Tear down the existing local registry before re-init so we never
    // re-register the same plugin name twice (registerLocal would internally
    // destroy and replace, but draining first keeps the logs honest).
    //
    // Concurrency: between this unregister() and the initLocalPlugins()
    // below, the local plugin slot is empty. Any reader of
    // `regionService.getRegionInfo()` (or any sync job started in that
    // window) will see no active plugin and throw. Probability is low —
    // refresh fires only on admin toggles or the recovery mutation, neither
    // of which is in a hot path. If concurrent admin toggles ever become a
    // real concern, swap to a build-then-atomic-swap pattern.
    await this.pluginRegistry.unregister();

    await this.initLocalPlugins(allLocalConfigRows);

    const localPlugin = this.pluginRegistry.getLocal();
    if (!localPlugin) {
      throw new ServiceInitializationException(
        'No local region plugin available after initialization',
      );
    }

    this.regionService = new RegionProviderService(localPlugin);
    const info = this.regionService.getRegionInfo();
    this.pluginRegionName = info.name;

    const pluginCfg = localConfigRow?.config as unknown as
      | DeclarativeRegionConfig
      | undefined;
    this.pluginNormalizeDistrict =
      pluginCfg?.normalizeExternalIdDistrict ?? false;
    this.pluginBioNoisePatterns = (pluginCfg?.bioNoisePatterns ?? []).map(
      (p) => new RegExp(p, 'i'),
    );
    this.logger.log(
      `RegionSyncService active plugin: ${this.regionService.getProviderName()} (${info.name}), ` +
        `federal: ${this.pluginRegistry.getFederal() ? 'loaded' : 'not loaded'}`,
    );
  }

  private async initFederalPlugin(
    stateCode: string | undefined,
  ): Promise<void> {
    try {
      const federalConfig = await this.db.regionPlugin.findUnique({
        where: { name: 'federal' },
      });
      if (!federalConfig) {
        this.logger.warn(
          'Federal region config not found in database — FEC data will not be available',
        );
        return;
      }

      let config = federalConfig.config as Record<string, unknown>;
      if (stateCode) {
        config = resolveConfigPlaceholders(config, { stateCode });
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
    } catch (error) {
      this.logger.error(
        `Failed to load federal plugin: ${(error as Error).message}`,
      );
    }
  }

  private async initLocalPlugins(
    rows: { name: string; config: unknown; parentRegionId: string | null }[],
  ): Promise<void> {
    if (rows.length === 0) {
      this.logger.warn(
        'No enabled local region plugins found in database, falling back to ExampleRegionProvider',
      );
      await this.pluginRegistry.registerLocal(
        'example',
        this.createFallbackPlugin(),
      );
      return;
    }

    for (const row of rows) {
      try {
        this.logger.log(
          `Loading local declarative region plugin "${row.name}"`,
        );
        await this.pluginLoader.loadPlugin(
          {
            name: row.name,
            config: row.config as Record<string, unknown> | undefined,
          },
          this.pipeline,
        );
      } catch (error) {
        this.logger.error(
          `Failed to load plugin "${row.name}": ${(error as Error).message}`,
        );
      }
    }

    if (!this.pluginRegistry.hasActive()) {
      this.logger.warn(
        'All local plugins failed to load, falling back to ExampleRegionProvider',
      );
      await this.pluginRegistry.registerLocal(
        'example',
        this.createFallbackPlugin(),
      );
    }
  }

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

  // ─── Plugin state / admin reads ──────────────────────────────────────────────

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

  async listRegionPlugins(): Promise<RegionPluginRow[]> {
    const rows = await this.db.regionPlugin.findMany({
      select: {
        name: true,
        displayName: true,
        description: true,
        version: true,
        enabled: true,
        parentRegionId: true,
        fipsCode: true,
      },
      orderBy: [{ parentRegionId: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toRegionPluginRow);
  }

  async getPluginDataSourceConfigs(): Promise<
    Array<{ regionId: string; sources: DataSourceConfig[] }>
  > {
    const rows = await this.db.regionPlugin.findMany({
      where: { enabled: true },
      select: { name: true, config: true },
    });
    return rows
      .map((row) => {
        const cfg = row.config as unknown as
          | DeclarativeRegionConfig
          | undefined;
        return {
          regionId: row.name,
          sources: cfg?.dataSources ?? [],
        };
      })
      .filter((entry) => entry.sources.length > 0);
  }

  async getRegionPluginByFipsCode(
    fipsCode: string,
  ): Promise<RegionPluginRow | null> {
    const row = await this.db.regionPlugin.findUnique({
      where: { fipsCode },
      select: {
        name: true,
        displayName: true,
        description: true,
        version: true,
        enabled: true,
        parentRegionId: true,
        fipsCode: true,
      },
    });
    return row ? toRegionPluginRow(row) : null;
  }

  async setRegionPluginEnabled(
    name: string,
    enabled: boolean,
  ): Promise<RegionPluginRow> {
    const row = await this.db.regionPlugin.update({
      where: { name },
      data: { enabled },
      select: {
        name: true,
        displayName: true,
        description: true,
        version: true,
        enabled: true,
        parentRegionId: true,
        fipsCode: true,
      },
    });
    this.logger.log(
      `Region plugin "${name}" ${enabled ? 'enabled' : 'disabled'}`,
    );
    // Hot-swap the active plugin so the change takes effect immediately —
    // without this, the in-memory registry stays on whatever it loaded at
    // boot and `regionInfo` keeps returning the stale active region. See
    // #796 for the failure mode this fixes.
    await this.refreshActiveLocalPlugin();
    return toRegionPluginRow(row);
  }

  async invalidateManifest(
    regionId: string,
    sourceUrl: string,
  ): Promise<number> {
    if (!this.pipeline) {
      throw new Error(
        'ScrapingPipelineService unavailable — cannot invalidate manifest',
      );
    }
    return this.pipeline.invalidateManifest(regionId, sourceUrl);
  }

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
            parentRegionId: file.config.parentRegionId ?? null,
            fipsCode: file.config.fipsCode ?? null,
            config: file.config as unknown as Prisma.InputJsonValue,
          },
          create: {
            name: file.name,
            displayName: file.displayName,
            description: file.description,
            version: file.version,
            pluginType: 'declarative',
            parentRegionId: file.config.parentRegionId ?? null,
            fipsCode: file.config.fipsCode ?? null,
            enabled: file.name === 'federal',
            config: file.config as unknown as Prisma.InputJsonValue,
          },
        });
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

  // ─── Sync orchestration ───────────────────────────────────────────────────────

  async syncAll(
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    depth: string = SyncDepth.STATE,
    scopedRegionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    // Re-read enabled plugins from the DB before every sync. The hot-swap
    // on `setRegionPluginEnabled` only fires in the *region service* process;
    // the region-worker has its own Nest instance with its own in-memory
    // registry that would otherwise drift after an admin toggle, causing
    // syncs for newly-enabled plugins to silently process 0 data types.
    await this.refreshActiveLocalPlugin();

    const limits = [
      maxReps != null ? `maxReps=${maxReps}` : null,
      maxBills != null ? `maxBills=${maxBills}` : null,
      depth !== SyncDepth.STATE ? `depth=${depth}` : null,
      scopedRegionId ? `regionId=${scopedRegionId}` : null,
      forceStatusRecheck ? 'forceStatusRecheck=true' : null,
    ].filter(Boolean);
    const limitsStr = limits.length ? ` (${limits.join(', ')})` : '';
    this.logger.log(
      dataTypes
        ? `Starting data sync for: ${dataTypes.join(', ')}${limitsStr}`
        : `Starting full data sync${limitsStr}`,
    );
    const results: SyncResult[] = [];

    const statePlugins =
      depth === SyncDepth.COUNTY
        ? []
        : this.pluginRegistry
            .getAll()
            .filter((p) => !scopedRegionId || p.name === scopedRegionId);

    for (const registered of statePlugins) {
      results.push(
        ...(await this.runPluginSync(
          registered.instance,
          registered.name,
          dataTypes,
          maxReps,
          maxBills,
          pipelineJobId,
          forceStatusRecheck,
        )),
      );
    }

    if (depth === SyncDepth.COUNTY || depth === SyncDepth.ALL) {
      results.push(
        ...(await this.syncCountyPlugins(
          dataTypes,
          maxReps,
          maxBills,
          scopedRegionId,
          pipelineJobId,
          forceStatusRecheck,
        )),
      );
    }

    this.logger.log(`Sync complete. Processed ${results.length} data type(s).`);
    return results;
  }

  private async runPluginSync(
    instance: IRegionPlugin,
    name: string,
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    const supported = instance.getSupportedDataTypes();
    const filtered = dataTypes
      ? supported.filter((dt) => dataTypes.includes(dt))
      : supported;
    const results: SyncResult[] = [];
    for (const dataType of filtered) {
      try {
        const result = await this.syncDataTypeFrom(
          instance,
          name,
          dataType,
          maxReps,
          maxBills,
          name,
          pipelineJobId,
          forceStatusRecheck,
        );
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync ${dataType} from ${name}:`, error);
        results.push({
          regionId: name,
          dataType,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: [(error as Error).message],
          syncedAt: new Date(),
        });
      }
    }
    return results;
  }

  private async syncCountyPlugins(
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    scopedRegionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    const where = scopedRegionId
      ? { name: scopedRegionId, parentRegionId: { not: null }, enabled: true }
      : { parentRegionId: { not: null }, enabled: true };

    const countyRows = await this.db.regionPlugin.findMany({
      where,
      select: { name: true, config: true },
      orderBy: { name: 'asc' },
    });

    if (countyRows.length === 0) {
      this.logger.debug('No enabled county plugins found for sync');
      return [];
    }

    this.logger.log(`Syncing ${countyRows.length} county plugin(s)…`);
    const results: SyncResult[] = [];

    for (const row of countyRows) {
      if (!row.config) continue;
      try {
        if (!this.pipeline) {
          throw new Error(
            'ScrapingPipelineService unavailable — county sync requires a pipeline',
          );
        }
        const plugin = new DeclarativeRegionPlugin(
          row.config as unknown as DeclarativeRegionConfig,
          this.pipeline,
        );
        results.push(
          ...(await this.runPluginSync(
            plugin,
            row.name,
            dataTypes,
            maxReps,
            maxBills,
            pipelineJobId,
            forceStatusRecheck,
          )),
        );
      } catch (error) {
        this.logger.error(
          `Failed to instantiate county plugin ${row.name}:`,
          error,
        );
        results.push({
          regionId: row.name,
          dataType: DataType.REPRESENTATIVES,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: [(error as Error).message],
          syncedAt: new Date(),
        });
      }
    }
    return results;
  }

  async syncDataType(dataType: DataType): Promise<SyncResult> {
    return this.syncDataTypeFrom(
      this.regionService,
      this.pluginRegistry.getActiveName() ?? 'local',
      dataType,
    );
  }

  private async syncDataTypeFrom(
    provider: DataFetcher,
    pluginName: string,
    dataType: DataType,
    maxReps?: number,
    maxBills?: number,
    regionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult> {
    this.logger.log(`Syncing ${dataType} from ${pluginName}`);
    const startTime = Date.now();

    const syncHandlers: Partial<
      Record<
        DataType,
        () => Promise<{
          processed: number;
          created: number;
          updated: number;
          skipped?: number;
        }>
      >
    > = {
      [DataType.PROPOSITIONS]: () =>
        this.syncPropositions(provider, pipelineJobId),
      [DataType.MEETINGS]: () => this.syncMeetings(provider, pipelineJobId),
      [DataType.REPRESENTATIVES]: () =>
        this.syncRepresentatives(provider, maxReps, regionId),
      [DataType.CAMPAIGN_FINANCE]: () =>
        this.syncCampaignFinance(provider, pipelineJobId),
      [DataType.CIVICS]: () => this.syncCivics(provider),
      [DataType.BILLS]: () =>
        this.syncBills(maxBills, provider, forceStatusRecheck),
    };

    const handler = syncHandlers[dataType];
    if (!handler) {
      this.logger.warn(`No sync handler for data type: ${dataType}`);
      return {
        regionId: pluginName,
        dataType,
        itemsProcessed: 0,
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsSkipped: 0,
        errors: [`No sync handler for data type: ${dataType}`],
        syncedAt: new Date(),
      };
    }
    const { processed, created, updated, skipped = 0 } = await handler();

    const duration = Date.now() - startTime;
    const skippedStr = skipped > 0 ? `, ${skipped} skipped` : '';
    this.logger.log(
      `Synced ${dataType} from ${pluginName}: ${processed} items (${created} created, ${updated} updated${skippedStr}) in ${duration}ms`,
    );

    return {
      regionId: pluginName,
      dataType,
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsSkipped: skipped,
      errors: [],
      syncedAt: new Date(),
    };
  }

  // ─── upsert helper ────────────────────────────────────────────────────────────

  private async upsertByExternalId<T extends ExternalIdRecord>(
    items: T[],
    findExisting: (externalIds: string[]) => Promise<ExternalIdRecord[]>,
    buildOps: (items: T[]) => Prisma.PrismaPromise<unknown>[],
    cachePrefix: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (items.length === 0) return { processed: 0, created: 0, updated: 0 };

    const externalIds = items.map((i) => i.externalId);
    const existingRecords = await findExisting(externalIds);
    const existingSet = new Set(existingRecords.map((r) => r.externalId));

    await batchTransaction(this.db, buildOps(items));
    await this.cacheService.invalidateCache(cachePrefix);

    return {
      processed: items.length,
      created: items.filter((i) => !existingSet.has(i.externalId)).length,
      updated: items.filter((i) => existingSet.has(i.externalId)).length,
    };
  }

  // ─── Per-type sync methods ────────────────────────────────────────────────────

  private async syncPropositions(
    provider: DataFetcher = this.regionService,
    pipelineJobId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const propositions = await provider.fetchPropositions(pipelineJobId);

    const regionId = provider.getName?.() ?? 'unknown';
    const stagePatterns = await this.buildStagePatterns(regionId);

    const result = await this.upsertByExternalId(
      propositions,
      (ids) =>
        this.db.proposition.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (props) =>
        props.map((prop) => {
          const lifecycleStageId = this.resolveStageFromStatus(
            prop.status,
            stagePatterns,
          );
          return this.db.proposition.upsert({
            where: { externalId: prop.externalId },
            update: {
              title: prop.title,
              summary: prop.summary,
              fullText: prop.fullText,
              status: prop.status,
              electionDate: prop.electionDate,
              sourceUrl: prop.sourceUrl,
              lifecycleStageId,
            },
            create: {
              externalId: prop.externalId,
              title: prop.title,
              summary: prop.summary,
              fullText: prop.fullText,
              status: prop.status,
              electionDate: prop.electionDate,
              sourceUrl: prop.sourceUrl,
              lifecycleStageId,
            },
          });
        }),
      'propositions:',
    );

    if (stagePatterns.length > 0) {
      await this.backfillPropositionStageIds(stagePatterns);
    }

    if (this.propositionAnalysis) {
      try {
        await this.propositionAnalysis.generateMissing();
      } catch (error) {
        this.logger.warn(
          `Proposition analysis post-sync pass failed: ${(error as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * Resolve `lifecycleStageId` for propositions that were ingested before
   * civics patterns were available, or whose status matched no pattern at
   * the time of upsert. Mirrors `backfillBillStageIds`. Idempotent.
   *
   * Unlike the bill equivalent, this is NOT region-scoped because
   * Proposition has no `regionId` column today. Safe for single-region
   * deployments; will need a Proposition.regionId migration before a
   * second region is added. Tracked in opuspopuli#731.
   */
  private async backfillPropositionStageIds(
    stagePatterns: StagePattern[],
  ): Promise<void> {
    const unmatched = await this.db.proposition.findMany({
      where: { lifecycleStageId: null, deletedAt: null },
      select: { id: true, status: true },
    });
    if (unmatched.length === 0) return;

    const byStage = new Map<string, string[]>();
    for (const prop of unmatched) {
      const stageId = this.resolveStageFromStatus(prop.status, stagePatterns);
      if (!stageId) continue;
      if (!byStage.has(stageId)) byStage.set(stageId, []);
      byStage.get(stageId)!.push(prop.id);
    }

    let filled = 0;
    for (const [stageId, ids] of byStage) {
      await this.db.proposition.updateMany({
        where: { id: { in: ids } },
        data: { lifecycleStageId: stageId },
      });
      filled += ids.length;
    }
    if (filled > 0) {
      this.logger.log(
        `Propositions: backfilled lifecycleStageId for ${filled} of ${unmatched.length} proposition(s)`,
      );
    }
  }

  async regeneratePropositionAnalysis(id: string): Promise<boolean> {
    if (!this.propositionAnalysis) return false;
    const result = await this.propositionAnalysis.generate(id, true);
    if (result) {
      await this.cacheService.invalidateCache('propositions:');
    }
    return result;
  }

  private async syncMeetings(
    provider: DataFetcher = this.regionService,
    pipelineJobId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const meetings = await provider.fetchMeetings(pipelineJobId);
    if (meetings.length === 0) {
      return this.syncMeetingMinutes(provider);
    }

    const result = await this.upsertByExternalId(
      meetings,
      (ids) =>
        this.db.meeting.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (items) =>
        items.map((meeting) =>
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
      'meetings:',
    );

    const minutesResult = await this.syncMeetingMinutes(provider);
    return {
      processed: result.processed + minutesResult.processed,
      created: result.created + minutesResult.created,
      updated: result.updated + minutesResult.updated,
    };
  }

  private async syncMeetingMinutes(
    provider: DataFetcher = this.regionService,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    if (!provider.fetchMeetingMinutes) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const bundles = await provider.fetchMeetingMinutes();
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

  private sanitizeDistrict(rep: Representative): string {
    const raw = (rep.district ?? '').trim();
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

  private normalizeRep(r: Representative): void {
    if (this.pluginNormalizeDistrict) {
      r.externalId = stripLeadingZerosFromExternalId(r.externalId);
    }
    if (r.bio && !isLikelyValidBio(r.bio, this.pluginBioNoisePatterns)) {
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
    regionId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const reps = await provider.fetchRepresentatives();

    // Chamber attribution happens at fetch time in
    // DeclarativeRegionPlugin.fetchRepresentatives — each rep is stamped
    // with the source's `category` (Assembly / Senate / Board of
    // Supervisors / …) before it leaves the plugin. The old
    // `applyChamberFallback` here relied on `instanceof
    // DeclarativeRegionPlugin` which silently failed across worker
    // bundles, leaving chamber undefined and causing Prisma to reject
    // every upsert. Removed in the #745 code review.
    for (const r of reps) {
      this.normalizeRep(r);
    }

    if (this.bioGenerator) {
      await this.bioGenerator.enrichBios(reps, this.pluginRegionName, maxReps);
    }

    const result = await this.upsertByExternalId(
      reps,
      (ids) =>
        this.db.representative.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (items) =>
        items.map((rep) => {
          const lastName = extractLastName(rep.name);
          const district = this.sanitizeDistrict(rep);
          return this.db.representative.upsert({
            where: { externalId: rep.externalId },
            update: {
              regionId: regionId ?? rep.regionId ?? 'california',
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
              regionId: regionId ?? rep.regionId ?? 'california',
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
      'representatives:',
    );

    if (this.committeeSummaryGenerator) {
      await this.committeeSummaryGenerator.generateMissingSummaries(maxReps);
    }

    if (this.legislativeCommitteeLinker) {
      try {
        await this.legislativeCommitteeLinker.linkAll();
      } catch (error) {
        this.logger.warn(
          `Legislative committee linker failed: ${(error as Error).message}`,
        );
      }
    }

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

    return result;
  }

  private async ensureCommitteeStubs(
    data: CampaignFinanceResult,
  ): Promise<void> {
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
      existing.map((c: CommitteeRecord) => [c.externalId, c.id]),
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
              sourceSystem: sourceSystemByExternalId.get(externalId) ?? 'fec',
            },
          }),
        ),
      );
    }

    const allCommittees = await this.db.committee.findMany({
      where: { externalId: { in: [...referencedIds] } },
      select: { externalId: true, id: true },
    });
    const idMap = new Map(
      allCommittees.map((c: CommitteeRecord) => [c.externalId, c.id]),
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

  private async syncCampaignFinance(
    provider: DataFetcher,
    pipelineJobId?: string,
  ): Promise<{
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

    const onBatch = async (items: Record<string, unknown>[]) => {
      const batchData = this.sortCampaignFinanceItems(items);
      await this.ensureCommitteeStubs(batchData);
      const result = await this.upsertCampaignFinanceBatch(batchData);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
    };

    const data = await provider.fetchCampaignFinance(onBatch, pipelineJobId);

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

  private async syncCivics(plugin: DataFetcher): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    if (!this.promptClient || !this.llm) {
      this.logger.warn(
        'Civics sync requires PromptClient and LLM provider; skipping',
      );
      return { processed: 0, created: 0, updated: 0 };
    }

    if (!plugin?.getDataSources) {
      this.logger.warn(
        'Region plugin does not expose getDataSources(); skipping civics sync',
      );
      return { processed: 0, created: 0, updated: 0 };
    }

    const dataSources = plugin.getDataSources(DataType.CIVICS);
    if (dataSources.length === 0) {
      this.logger.log('No civics data sources configured for this region');
      return { processed: 0, created: 0, updated: 0 };
    }

    const registeredHosts = new Set(
      plugin.getDataSources().flatMap((s) => {
        try {
          return [new URL(s.url).hostname];
        } catch {
          return [];
        }
      }),
    );

    const regionId = plugin.getName?.() ?? 'unknown';
    let processed = 0;
    let created = 0;
    let updated = 0;

    for (const ds of dataSources) {
      const urls = await this.crawlCivicsUrls(ds, registeredHosts);
      this.logger.log(
        `Civics: crawl from ${ds.url} (depth ${ds.crawlDepth ?? 0}) found ${urls.length} page(s)`,
      );
      for (const url of urls) {
        const result = await this.extractAndUpsertCivicsPage(regionId, url, ds);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        if (result !== 'failed') processed++;
      }
    }

    return { processed, created, updated };
  }

  // ─── Bills sync ───────────────────────────────────────────────────────────────

  private async syncBills(
    maxBills: number | undefined,
    plugin: DataFetcher,
    forceStatusRecheck: boolean = false,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
    skipped: number;
  }> {
    if (!this.promptClient || !this.llm) {
      this.logger.warn('Bills sync requires PromptClient and LLM; skipping');
      return { processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    if (!plugin?.getDataSources) {
      this.logger.warn(
        'Region plugin does not expose getDataSources(); skipping bills sync',
      );
      return { processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    const dataSources = plugin.getDataSources(DataType.BILLS);
    if (dataSources.length === 0) {
      this.logger.log('No bills data sources configured for this region');
      return { processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    const registeredHosts = new Set(
      plugin.getDataSources().flatMap((s) => {
        try {
          return [new URL(s.url).hostname];
        } catch {
          return [];
        }
      }),
    );

    // Apply per-source rate limits to the shared host throttle. Each bills
    // data source may override the default 1 req/sec gap via
    // DataSourceConfig.rateLimitOverride (requests/sec). The override
    // applies to the source's hostname, which transitively covers the
    // status / votes / text page templates (all on the same host).
    for (const ds of dataSources) {
      if (ds.rateLimitOverride && ds.rateLimitOverride > 0) {
        try {
          const host = new URL(ds.url).hostname;
          this.hostThrottle.setRequestsPerSecond(host, ds.rateLimitOverride);
          this.logger.log(
            `Bills: host throttle for ${host} set to ${ds.rateLimitOverride} req/sec`,
          );
        } catch {
          /* invalid URL — surfaced elsewhere */
        }
      }
    }

    const regionId = plugin.getName?.() ?? 'unknown';
    const repIndex = await this.buildRepNameIndex(regionId);
    const committeeIndex = await this.buildCommitteeNameIndex();
    const stagePatterns = await this.buildStagePatterns(regionId);
    const billsByExternalId = await this.loadBillSkipMetadata(regionId);

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skippedTotal = 0;
    const syncedExternalIds = new Set<string>();

    for (const ds of dataSources) {
      const counts = await this.syncBillsFromDataSource(
        regionId,
        ds,
        registeredHosts,
        repIndex,
        committeeIndex,
        syncedExternalIds,
        stagePatterns,
        billsByExternalId,
        maxBills,
        forceStatusRecheck,
      );
      processed += counts.processed;
      created += counts.created;
      updated += counts.updated;
      skippedTotal += counts.skipped;
    }

    if (stagePatterns.length > 0) {
      await this.backfillBillStageIds(regionId, stagePatterns);
    }

    await this.pruneStaleBills(regionId, syncedExternalIds, maxBills);

    // Enrichment is a second pass: extraction (above) is the prerequisite,
    // but enrichment can be re-run independently when the bill-analysis
    // prompt template version bumps (see #741). Bounded by maxBills.
    await this.enrichBillSummaries(regionId, maxBills);

    return { processed, created, updated, skipped: skippedTotal };
  }

  private async syncBillsFromDataSource(
    regionId: string,
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
    repIndex: Map<string, { id: string; chamber: string }>,
    committeeIndex: Map<string, string>,
    syncedExternalIds: Set<string>,
    stagePatterns: StagePattern[],
    billsByExternalId: Map<string, BillSkipRecord>,
    maxBills?: number,
    forceStatusRecheck: boolean = false,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
    skipped: number;
  }> {
    const { statusUrls, votesUrls } = await this.discoverBillUrls(
      ds,
      registeredHosts,
      maxBills,
    );
    this.logger.log(
      `Bills: discovered ${statusUrls.length} bill(s) from ${ds.url}`,
    );

    const counts = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      statusOnlyMatched: 0,
    };

    for (const url of statusUrls) {
      await this.processOneBillUrl(url, {
        regionId,
        ds,
        repIndex,
        committeeIndex,
        stagePatterns,
        billsByExternalId,
        forceStatusRecheck,
        syncedExternalIds,
        counts,
      });
    }
    if (counts.skipped > 0) {
      this.logger.log(
        `Bills: skipped ${counts.skipped} unchanged bill(s) from ${ds.url}`,
      );
    }
    if (counts.statusOnlyMatched > 0) {
      this.logger.log(
        `Bills: status-only re-check matched ${counts.statusOnlyMatched} unchanged bill(s) from ${ds.url} (no LLM)`,
      );
    }

    for (const url of votesUrls) {
      const result = await this.extractVotesOnlyPage(
        regionId,
        url,
        ds,
        repIndex,
      );
      if (result === 'updated') counts.updated++;
    }

    return {
      processed: counts.processed,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
    };
  }

  /**
   * Process a single bill discovery URL: try the cheap status-only
   * re-check first, then fall through to the full LLM extraction. Mutates
   * the shared `counts` object and `syncedExternalIds` set in place.
   */
  private async processOneBillUrl(
    url: string,
    ctx: {
      regionId: string;
      ds: DataSourceConfig;
      repIndex: Map<string, { id: string; chamber: string }>;
      committeeIndex: Map<string, string>;
      stagePatterns: StagePattern[];
      billsByExternalId: Map<string, BillSkipRecord>;
      forceStatusRecheck: boolean;
      syncedExternalIds: Set<string>;
      counts: {
        processed: number;
        created: number;
        updated: number;
        skipped: number;
        statusOnlyMatched: number;
      };
    },
  ): Promise<void> {
    const billId = this.safeBillIdFromUrl(url);

    // Status-only re-check path (#689): flagged-by-linker or forced by
    // weekly backstop. Unchanged → skip cheaply; otherwise fall through.
    if (billId) {
      const recheck = await this.tryStatusOnlyRecheck(
        url,
        ctx.forceStatusRecheck,
        ctx.billsByExternalId.get(billId),
      );
      if (recheck === 'unchanged') {
        ctx.counts.skipped++;
        ctx.counts.statusOnlyMatched++;
        ctx.counts.processed++;
        ctx.syncedExternalIds.add(billId);
        return;
      }
    }

    const result = await this.extractAndUpsertBillPage(
      ctx.regionId,
      url,
      ctx.ds,
      ctx.repIndex,
      ctx.committeeIndex,
      ctx.stagePatterns,
    );
    if (result === 'created') {
      ctx.counts.created++;
      ctx.counts.processed++;
    } else if (result === 'updated') {
      ctx.counts.updated++;
      ctx.counts.processed++;
    } else if (result === 'skipped') {
      ctx.counts.skipped++;
      ctx.counts.processed++;
    }
    if (result !== 'failed' && billId) {
      ctx.syncedExternalIds.add(billId);
    }
  }

  private async buildStagePatterns(regionId: string): Promise<StagePattern[]> {
    const civics = await this.getCivicsDataForSync(regionId);
    const patterns: StagePattern[] = [];
    for (const stage of civics?.lifecycleStages ?? []) {
      for (const raw of stage.statusStringPatterns) {
        try {
          patterns.push({ stageId: stage.id, regex: new RegExp(raw, 'i') });
        } catch {
          this.logger.warn(
            `Invalid status pattern "${raw}" for stage "${stage.id}" in ${regionId} — skipping`,
          );
        }
      }
    }
    return patterns;
  }

  /**
   * Internal helper to load civics data for bill stage pattern compilation.
   * Reads directly from DB without caching so sync always uses fresh data.
   */
  private async getCivicsDataForSync(regionId: string): Promise<{
    lifecycleStages: Array<{
      id: string;
      statusStringPatterns: string[];
    }>;
  } | null> {
    const rows = await this.db.civicsBlock.findMany({
      where: { regionId },
      orderBy: { extractedAt: 'desc' },
    });
    if (rows.length === 0) return null;
    const lifecycleStages = new Map<
      string,
      { id: string; statusStringPatterns: string[] }
    >();
    for (const row of rows) {
      const rawL = row.lifecycleStages as Record<string, unknown>[] | null;
      if (!rawL) continue;
      for (const ls of rawL) {
        const id = String(ls['id'] ?? '');
        if (!id || lifecycleStages.has(id)) continue;
        lifecycleStages.set(id, {
          id,
          statusStringPatterns: Array.isArray(ls['statusStringPatterns'])
            ? (ls['statusStringPatterns'] as string[])
            : [],
        });
      }
    }
    if (lifecycleStages.size === 0) return null;
    return { lifecycleStages: Array.from(lifecycleStages.values()) };
  }

  private resolveStageFromStatus(
    status: string | null | undefined,
    stagePatterns: StagePattern[],
  ): string | null {
    if (!status || stagePatterns.length === 0) return null;
    return stagePatterns.find((p) => p.regex.test(status))?.stageId ?? null;
  }

  private async backfillBillStageIds(
    regionId: string,
    stagePatterns: StagePattern[],
  ): Promise<void> {
    const unmatched = await this.db.bill.findMany({
      where: { regionId, currentStageId: null, status: { not: null } },
      select: { id: true, status: true },
    });
    if (unmatched.length === 0) return;

    const byStage = new Map<string, string[]>();
    for (const bill of unmatched) {
      const stageId = this.resolveStageFromStatus(bill.status, stagePatterns);
      if (!stageId) continue;
      if (!byStage.has(stageId)) byStage.set(stageId, []);
      byStage.get(stageId)!.push(bill.id);
    }

    let filled = 0;
    for (const [stageId, ids] of byStage) {
      await this.db.bill.updateMany({
        where: { id: { in: ids } },
        data: { currentStageId: stageId },
      });
      filled += ids.length;
    }
    if (filled > 0) {
      this.logger.log(
        `Bills: backfilled currentStageId for ${filled} of ${unmatched.length} bill(s) in ${regionId}`,
      );
    }
  }

  private async pruneStaleBills(
    regionId: string,
    syncedExternalIds: Set<string>,
    maxBills?: number,
  ): Promise<void> {
    if (syncedExternalIds.size === 0 || maxBills != null) return;

    const { count } = await this.db.bill.deleteMany({
      where: {
        regionId,
        externalId: { notIn: Array.from(syncedExternalIds) },
      },
    });
    if (count > 0) {
      this.logger.log(
        `Bills: removed ${count} stale bill record(s) for ${regionId}`,
      );
    }
  }

  /**
   * Enrich un-summarized bills with structured AI summaries from the
   * bill-analysis prompt-service endpoint. Runs as a second pass after
   * `syncBills` so extraction stays decoupled from summarization — a new
   * prompt-template version triggers re-enrichment without re-extracting.
   *
   * Idempotency: queries only bills where `ai_summary IS NULL`. Bills the
   * LLM marks `{ skip: true }` get that value stored (so they don't churn
   * on every sync); bills that fail with an LLM error stay NULL and are
   * retried on the next sync. To force re-enrichment for all bills (e.g.
   * after a prompt-template version bump), the operator nulls the column.
   *
   * Cost telemetry: per-bill debug log + per-job summary log. LLM is local
   * Ollama (`qwen3.5:9b` by default), so cost is compute time, not $$ —
   * the telemetry is for noticing spikes and regressions. See #741.
   */
  private async enrichBillSummaries(
    regionId: string,
    maxBills?: number,
  ): Promise<{ enriched: number; skipped: number; failed: number }> {
    if (!this.promptClient || !this.llm) {
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    const candidates = await this.db.bill.findMany({
      where: { regionId, aiSummary: { equals: Prisma.DbNull } },
      select: {
        id: true,
        regionId: true,
        billNumber: true,
        sessionYear: true,
        title: true,
        subject: true,
        status: true,
        authorName: true,
        fiscalImpact: true,
        fullTextUrl: true,
      },
      take: maxBills,
    });

    if (candidates.length === 0) {
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    this.logger.log(
      `Bill enrichment: starting ${candidates.length} bill(s) for ${regionId}`,
    );

    const counts = { enriched: 0, skipped: 0, failed: 0 };
    let totalTokens = 0;
    const startMs = Date.now();

    for (const bill of candidates) {
      const result = await this.enrichSingleBill(bill);
      counts[result.outcome] += 1;
      totalTokens += result.tokensUsed;
    }

    const totalDurationMs = Date.now() - startMs;
    this.logger.log(
      {
        event: 'bill_enrichment_summary',
        regionId,
        billsEnriched: counts.enriched,
        billsSkippedNoText: counts.skipped,
        billsFailed: counts.failed,
        totalTokens,
        totalDurationMs,
        avgTokensPerEnrichedBill:
          counts.enriched > 0 ? Math.round(totalTokens / counts.enriched) : 0,
      },
      `Bill enrichment ${regionId}: enriched=${counts.enriched} skipped=${counts.skipped} failed=${counts.failed} tokens=${totalTokens} ms=${totalDurationMs}`,
    );

    return counts;
  }

  private async enrichSingleBill(bill: BillEnrichmentCandidate): Promise<{
    outcome: 'enriched' | 'skipped' | 'failed';
    tokensUsed: number;
  }> {
    if (!bill.fullTextUrl) {
      this.logger.debug(
        `Bill enrichment: skipping ${bill.billNumber} — no fullTextUrl`,
      );
      return { outcome: 'skipped', tokensUsed: 0 };
    }

    try {
      const fullText = this.htmlToReadableText(
        await this.fetchUrlText(bill.fullTextUrl),
      );

      const { promptText, promptVersion } =
        await this.promptClient!.getBillAnalysisPrompt({
          regionId: bill.regionId,
          billNumber: bill.billNumber,
          sessionYear: bill.sessionYear,
          title: bill.title,
          subject: bill.subject ?? undefined,
          status: bill.status ?? undefined,
          authorName: bill.authorName ?? undefined,
          fiscalImpactSummary: bill.fiscalImpact ?? undefined,
          fullText,
        });

      const llmStart = Date.now();
      const llmResult = await this.llm!.generate(promptText, {
        maxTokens: 2000,
        temperature: 0.1,
      });
      const llmMs = Date.now() - llmStart;

      const candidate = extractJsonObjectSlice(llmResult.text);
      if (!candidate) {
        this.logger.warn(
          `Bill enrichment: no JSON returned for ${bill.billNumber}`,
        );
        return {
          outcome: 'failed',
          tokensUsed: llmResult.tokensUsed ?? 0,
        };
      }

      const parsed: unknown = JSON.parse(candidate);
      // Reject non-object payloads (the LLM occasionally returns `null` or
      // `[]` instead of the structured object). Storing those would lock
      // the bill out of the retry query (`ai_summary IS NULL`) with garbage
      // permanently in the column. Counted as failed → retried next sync.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(
          `Bill enrichment: non-object JSON payload for ${bill.billNumber}`,
        );
        return {
          outcome: 'failed',
          tokensUsed: llmResult.tokensUsed ?? 0,
        };
      }

      const summary = parsed as BillAiSummaryShape;
      await this.db.bill.update({
        where: { id: bill.id },
        data: {
          aiSummary: summary as Prisma.InputJsonValue,
          aiSummaryVersion: promptVersion,
          aiSummaryGeneratedAt: new Date(),
        },
      });

      this.logger.debug(
        {
          event: 'bill_enrichment',
          billId: bill.id,
          billNumber: bill.billNumber,
          promptVersion,
          tokensUsed: llmResult.tokensUsed ?? 0,
          latencyMs: llmMs,
          llmSkip: summary.skip === true,
        },
        `Bill enrichment ok: ${bill.billNumber} v${promptVersion} tokens=${llmResult.tokensUsed ?? 0} ms=${llmMs}`,
      );

      return {
        outcome: 'enriched',
        tokensUsed: llmResult.tokensUsed ?? 0,
      };
    } catch (e) {
      this.logger.warn(
        `Bill enrichment failed for ${bill.billNumber}: ${(e as Error).message}`,
      );
      return { outcome: 'failed', tokensUsed: 0 };
    }
  }

  private async discoverBillUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
    maxBills?: number,
  ): Promise<{ statusUrls: string[]; votesUrls: string[] }> {
    if (!ds.billDiscovery) {
      const urls = await this.crawlCivicsUrls(ds, registeredHosts);
      return {
        statusUrls: urls.filter((u) => u.includes('billStatusClient.xhtml')),
        votesUrls: urls.filter((u) => u.includes('billVotesClient.xhtml')),
      };
    }

    const { navLinkPattern, statusPageTemplate, votesPageTemplate } =
      ds.billDiscovery;

    const seedUrl = new URL(ds.url);
    if (
      seedUrl.protocol !== 'https:' ||
      !registeredHosts.has(seedUrl.hostname)
    ) {
      this.logger.error(
        `Bills discovery rejected: ${seedUrl.hostname} is not a registered host`,
      );
      return { statusUrls: [], votesUrls: [] };
    }

    const limit = maxBills ?? Infinity;
    let html: string;
    try {
      html = await this.fetchUrlText(ds.url);
    } catch (e) {
      this.logger.warn(
        `Bills: failed to fetch seed ${ds.url}: ${(e as Error).message}`,
      );
      return { statusUrls: [], votesUrls: [] };
    }

    const decoded = html.replace(/&amp;/g, '&');
    const re = new RegExp(navLinkPattern, 'g');
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(decoded)) !== null && seen.size < limit) {
      seen.add(m[1]);
    }

    const base = `${seedUrl.protocol}//${seedUrl.host}`;
    const statusUrls: string[] = [];
    const votesUrls: string[] = [];
    for (const billId of seen) {
      statusUrls.push(
        `${base}${statusPageTemplate.replace('{bill_id}', billId)}`,
      );
      votesUrls.push(
        `${base}${votesPageTemplate.replace('{bill_id}', billId)}`,
      );
    }

    return { statusUrls, votesUrls };
  }

  private async buildRepNameIndex(
    _: string,
  ): Promise<Map<string, { id: string; chamber: string }>> {
    const reps = await this.db.representative.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, chamber: true },
    });
    const index = new Map<string, { id: string; chamber: string }>();
    for (const r of reps) {
      index.set(r.name.toLowerCase().trim(), { id: r.id, chamber: r.chamber });
      const lastName = r.name.split(/\s+/).pop()?.toLowerCase() ?? '';
      if (lastName && !index.has(lastName)) {
        index.set(lastName, { id: r.id, chamber: r.chamber });
      }
    }
    return index;
  }

  private async buildCommitteeNameIndex(): Promise<Map<string, string>> {
    const committees = await this.db.legislativeCommittee.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const index = new Map<string, string>();
    for (const c of committees) {
      index.set(c.name.toLowerCase().trim(), c.id);
    }
    return index;
  }

  private resolveRepByName(
    name: string,
    index: Map<string, { id: string; chamber: string }>,
  ): string | undefined {
    const normalized = name.toLowerCase().trim();
    const exact = index.get(normalized);
    if (exact) return exact.id;
    const lastName = normalized.split(/\s+/).pop() ?? '';
    return lastName ? index.get(lastName)?.id : undefined;
  }

  private extractBillPublishedAt(html: string): string | null {
    const m = html.match(
      /Date Published:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/i,
    );
    return m ? m[1].trim() : null;
  }

  private async checkBillSkipCondition(
    billId: string,
    sourceUrl: string,
    textPageTemplate: string,
  ): Promise<Date | 'skipped' | null> {
    const base = new URL(sourceUrl).origin;
    const textUrl = `${base}${textPageTemplate.replace('{bill_id}', billId)}`;
    try {
      if (new URL(textUrl).hostname !== new URL(sourceUrl).hostname) {
        this.logger.warn(
          `Bills skip-check: textPageTemplate hostname mismatch, skipping for ${sourceUrl}`,
        );
        return null;
      }
      const textHtml = await this.fetchUrlText(textUrl);
      const remoteStr = this.extractBillPublishedAt(textHtml);
      if (!remoteStr) return null;

      const remoteDate = new Date(`${remoteStr} UTC`);
      if (isNaN(remoteDate.getTime())) return null;

      const existing = await this.db.bill.findUnique({
        where: { externalId: billId },
        select: { sourcePublishedAt: true },
      });
      if (
        existing?.sourcePublishedAt &&
        existing.sourcePublishedAt.getTime() === remoteDate.getTime()
      ) {
        return 'skipped';
      }
      return remoteDate;
    } catch {
      return null;
    }
  }

  private safeBillIdFromUrl(url: string): string | undefined {
    try {
      return new URL(url).searchParams.get('bill_id') ?? undefined;
    } catch {
      this.logger.warn(`Bills: malformed bill URL skipped: ${url}`);
      return undefined;
    }
  }

  /**
   * Extract change-detection signals from billStatusClient.xhtml for the
   * status-only re-check path (#689). Targets the actual leginfo markup:
   *
   *   - lastActionDate: <span id="lastAction" class="statusLabel">M/D/YY</span>
   *   - lastAction:    first row of the action history table
   *                    (<td scope="row">DATE</td><td>TEXT</td>)
   *
   * Note: the leginfo `status` cell ("Inactive Bill - Chaptered") differs
   * from the LLM-normalized DB `status` ("Chaptered"), so it is NOT used
   * for change detection — a raw-vs-normalized mismatch would trigger a
   * false positive on every check. Caller compares only lastActionDate +
   * lastAction text, which the LLM stores verbatim.
   */
  private extractBillStatusFields(html: string): {
    lastAction: string | null;
    lastActionDate: Date | null;
  } {
    const clean = (raw: string): string =>
      raw
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();

    // <span id="lastAction"...>M/D/YY</span> — 2-digit year on leginfo
    const dateMatch = html.match(
      /<span\s+id="lastAction"[^>]*>\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*</i,
    );
    let lastActionDate: Date | null = null;
    if (dateMatch) {
      const [, m, d, yRaw] = dateMatch;
      const year = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
      const dt = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
      if (!isNaN(dt.getTime())) lastActionDate = dt;
    }

    // First action history row: <td scope="row">DATE</td><td>TEXT</td>
    const actionMatch = html.match(
      /<td\s+scope="row">\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*<\/td>\s*<td>\s*([^<]+?)\s*</i,
    );
    const lastAction = actionMatch ? clean(actionMatch[1]) || null : null;

    return { lastAction, lastActionDate };
  }

  /**
   * Status-only re-check for bills flagged by the journal linker or forced
   * by the weekly backstop (#689). Compares lastActionDate + lastAction
   * text (both LLM-stored verbatim) against the raw page; status is
   * skipped because the LLM normalizes it ("Inactive Bill - Chaptered" →
   * "Chaptered") and a raw comparison would false-positive every time.
   *
   * Takes `existing` as a parameter to avoid a per-bill `findUnique` —
   * callers pre-load via `loadBillSkipMetadata` at sync start.
   */
  private async tryStatusOnlyRecheck(
    statusUrl: string,
    forceStatusRecheck: boolean,
    existing: BillSkipRecord | undefined,
  ): Promise<'unchanged' | 'no-recheck-needed' | 'fall-through'> {
    if (!existing) return 'fall-through'; // brand-new bill, full extraction
    if (!forceStatusRecheck && !existing.needsStatusRecheck) {
      return 'no-recheck-needed';
    }

    let html: string;
    try {
      html = await this.fetchUrlText(statusUrl);
    } catch {
      return 'fall-through';
    }
    const fields = this.extractBillStatusFields(html);

    // Both signals must parse cleanly. If the page structure shifts and a
    // regex breaks, fall through to LLM so we don't silently drift.
    if (fields.lastAction == null || fields.lastActionDate == null) {
      return 'fall-through';
    }

    const lastActionChanged = fields.lastAction !== existing.lastAction;
    const dateChanged =
      existing.lastActionDate == null ||
      existing.lastActionDate.getTime() !== fields.lastActionDate.getTime();

    if (lastActionChanged || dateChanged) {
      // Something new on the page — defer to LLM for authoritative update.
      // The LLM path clears needsStatusRecheck in its upsert.
      return 'fall-through';
    }

    // No material change. Clear the flag and skip.
    await this.db.bill.update({
      where: { id: existing.id },
      data: { needsStatusRecheck: false },
    });
    return 'unchanged';
  }

  /**
   * Pre-load the per-bill metadata that the inner loop needs for skip-gating
   * decisions (status-only re-check + sourcePublishedAt skip).
   *
   * Eliminates a per-bill `findUnique` in the iteration loop: with ~5k bills
   * per CA sync that's ~5k round-trips replaced by one bulk SELECT.
   */
  private async loadBillSkipMetadata(
    regionId: string,
  ): Promise<Map<string, BillSkipRecord>> {
    const rows = await this.db.bill.findMany({
      where: { regionId },
      select: {
        id: true,
        externalId: true,
        sourcePublishedAt: true,
        lastAction: true,
        lastActionDate: true,
        needsStatusRecheck: true,
      },
    });
    return new Map(rows.map((r) => [r.externalId, r]));
  }

  private parseBillJson(
    candidate: string,
    sourceUrl: string,
  ): (Partial<Bill> & { billNumber: string; title: string }) | null {
    let raw: Partial<Bill>;
    try {
      raw = JSON.parse(candidate) as Partial<Bill>;
    } catch {
      this.logger.warn(`Bills extraction: JSON parse failed for ${sourceUrl}`);
      return null;
    }
    if (!raw.billNumber || !raw.title) {
      this.logger.warn(
        `Bills extraction: missing required fields at ${sourceUrl}`,
      );
      return null;
    }
    return raw as Partial<Bill> & { billNumber: string; title: string };
  }

  private async extractAndUpsertBillPage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
    repIndex: Map<string, { id: string; chamber: string }>,
    committeeIndex: Map<string, string>,
    stagePatterns: StagePattern[],
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
    if (!this.promptClient || !this.llm) return 'failed';
    try {
      let sourcePublishedAt: Date | null = null;
      let billId: string | undefined;
      try {
        billId = new URL(sourceUrl).searchParams.get('bill_id') ?? undefined;
      } catch {
        /* invalid URL */
      }

      if (billId && ds.billDiscovery?.textPageTemplate) {
        const skipResult = await this.checkBillSkipCondition(
          billId,
          sourceUrl,
          ds.billDiscovery.textPageTemplate,
        );
        if (skipResult === 'skipped') return 'skipped';
        if (skipResult instanceof Date) sourcePublishedAt = skipResult;
      }

      const html = await this.fetchUrlText(sourceUrl);
      const content = this.htmlToReadableText(html);
      const sessionYear = this.inferSessionYear(sourceUrl);

      const { promptText } = await this.promptClient.getBillExtractionPrompt({
        regionId,
        sourceUrl,
        sessionYear,
        html: content,
      });

      const llmResult = await this.llm.generate(promptText, {
        maxTokens: ds.llmMaxTokens ?? 8000,
        temperature: 0.1,
        requestTimeoutMs: ds.llmRequestTimeoutMs,
      });

      const candidate = extractJsonObjectSlice(llmResult.text);
      if (!candidate) {
        this.logger.warn(`Bills extraction: no JSON for ${sourceUrl}`);
        return 'failed';
      }

      const raw = this.parseBillJson(candidate, sourceUrl);
      if (!raw) return 'failed';

      const externalId =
        billId ?? raw.externalId ?? this.buildBillExternalId(raw);
      const authorId = raw.authorName
        ? this.resolveRepByName(raw.authorName, repIndex)
        : undefined;
      const existing = await this.db.bill.findUnique({
        where: { externalId },
        select: { id: true },
      });

      const measureTypeCode =
        raw.measureTypeCode ?? this.inferMeasureTypeCode(raw.billNumber);
      if (!measureTypeCode) {
        this.logger.warn(
          `Bills extraction: cannot determine measureTypeCode for "${raw.billNumber}" at ${sourceUrl}`,
        );
        return 'failed';
      }

      const resolvedCurrentStageId =
        raw.currentStageId ??
        this.resolveStageFromStatus(raw.status, stagePatterns);
      const resolvedSessionYear = raw.sessionYear ?? sessionYear;
      const resolvedLastActionDate = raw.lastActionDate
        ? new Date(raw.lastActionDate as unknown as string)
        : null;

      // Snapshot now() once so both lifecycle helpers see the same moment —
      // avoids a sub-millisecond drift between today and activeSessionYears.
      const now = new Date();
      const lifecycleInput = {
        status: raw.status ?? null,
        currentStageId: resolvedCurrentStageId,
        sessionYear: resolvedSessionYear,
        lastAction: raw.lastAction ?? null,
        lastActionDate: resolvedLastActionDate,
      };
      const lifecycleCtx = {
        today: now,
        activeSessionYears: computeActiveCaSessionYears(now),
      };

      const billData = {
        regionId,
        billNumber: raw.billNumber,
        sessionYear: resolvedSessionYear,
        measureTypeCode,
        title: raw.title,
        subject: raw.subject ?? null,
        status: raw.status ?? null,
        currentStageId: resolvedCurrentStageId,
        lastAction: raw.lastAction ?? null,
        lastActionDate: resolvedLastActionDate,
        fiscalImpact: raw.fiscalImpact ?? null,
        fullTextUrl: raw.fullTextUrl ?? null,
        authorId: authorId ?? null,
        authorName: raw.authorName ?? null,
        sourceUrl,
        sourcePublishedAt,
        // A successful full extraction always clears the status-recheck
        // flag — whether the bill arrived here via the journal flag or the
        // weekly backstop, the LLM update is authoritative. See #689.
        needsStatusRecheck: false,
        // Procedural lifecycle flags (#747). Computed at write time so list/
        // search/feed queries don't re-evaluate the rules per row. The two
        // booleans form a 3-way partition (active | passed/chaptered |
        // dead); see bill-lifecycle.ts for the rules. Sync re-evaluates on
        // each run — the helpers are deterministic, so re-runs are no-ops
        // until the source status changes.
        isDead: isBillDead(lifecycleInput, lifecycleCtx),
        isActive: isBillActive(lifecycleInput, lifecycleCtx),
        extractedAt: now,
      };
      const bill = await this.db.bill.upsert({
        where: { externalId },
        create: { externalId, ...billData },
        update: billData,
        select: { id: true },
      });

      await this.linkBillCoAuthors(bill.id, raw.coAuthorNames ?? [], repIndex);
      await this.linkBillCommittees(
        bill.id,
        raw.committeeNames ?? [],
        committeeIndex,
      );
      await this.linkBillVotes(bill.id, raw.votes ?? [], repIndex, sourceUrl);

      return existing ? 'updated' : 'created';
    } catch (e) {
      this.logger.warn(
        `Bills extraction failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return 'failed';
    }
  }

  private async extractVotesOnlyPage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
    repIndex: Map<string, { id: string; chamber: string }>,
  ): Promise<'updated' | 'failed' | 'skipped'> {
    if (!this.promptClient || !this.llm) return 'failed';
    try {
      const billIdParam = new URL(sourceUrl).searchParams.get('bill_id');
      if (!billIdParam) return 'skipped';

      const bill = await this.db.bill.findUnique({
        where: { externalId: billIdParam },
        select: { id: true },
      });
      if (!bill) {
        this.logger.debug(
          `Bills: votes page skipped — no bill record yet for ${billIdParam}`,
        );
        return 'skipped';
      }

      const html = await this.fetchUrlText(sourceUrl);
      const content = this.htmlToReadableText(html);
      const sessionYear = this.inferSessionYear(sourceUrl);

      const { promptText } = await this.promptClient.getBillExtractionPrompt({
        regionId,
        sourceUrl,
        sessionYear,
        html: content,
      });

      const llmResult = await this.llm.generate(promptText, {
        maxTokens: ds.llmMaxTokens ?? 4000,
        temperature: 0.1,
        requestTimeoutMs: ds.llmRequestTimeoutMs,
      });

      const candidate = extractJsonObjectSlice(llmResult.text);
      if (!candidate) return 'failed';

      let raw: { votes?: Bill['votes'] };
      try {
        raw = JSON.parse(candidate) as { votes?: Bill['votes'] };
      } catch {
        return 'failed';
      }

      if (!raw.votes?.length) return 'skipped';

      await this.linkBillVotes(bill.id, raw.votes, repIndex, sourceUrl);
      this.logger.log(
        `Bills: merged ${raw.votes.length} vote(s) for ${billIdParam}`,
      );
      return 'updated';
    } catch (e) {
      this.logger.warn(
        `Bills: votes extraction failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return 'failed';
    }
  }

  private buildBillExternalId(raw: Partial<Bill>): string {
    const year = (raw.sessionYear ?? '').replace(/\D/g, '');
    const num = (raw.billNumber ?? '').replace(/\s/g, '');
    return `${year}${num}`;
  }

  private inferMeasureTypeCode(billNumber: string): string | null {
    return (
      billNumber
        .replace(/\s*\d+.*$/, '')
        .trim()
        .toUpperCase() || null
    );
  }

  private inferSessionYear(url: string): string {
    try {
      const billId = new URL(url).searchParams.get('bill_id');
      if (billId) {
        const m = billId.match(/^(\d{4})(\d{4})/);
        if (m && Number(m[2]) === Number(m[1]) + 1) return `${m[1]}-${m[2]}`;
      }
    } catch {
      /* invalid URL, fall through */
    }
    const m = url.match(/(\d{4})(\d{4})/);
    if (m && Number(m[2]) === Number(m[1]) + 1) return `${m[1]}-${m[2]}`;
    const y = new Date().getFullYear();
    return `${y}-${y + 1}`;
  }

  private async linkBillCoAuthors(
    billId: string,
    names: string[],
    repIndex: Map<string, { id: string; chamber: string }>,
  ): Promise<void> {
    await this.db.billCoAuthor.deleteMany({ where: { billId } });
    const rows = names
      .map((name) => {
        const repId = this.resolveRepByName(name, repIndex);
        return repId
          ? { billId, representativeId: repId, coAuthorType: 'coauthor' }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      await this.db.billCoAuthor.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  }

  private async linkBillCommittees(
    billId: string,
    names: string[],
    committeeIndex: Map<string, string>,
  ): Promise<void> {
    await this.db.billCommitteeAssignment.deleteMany({ where: { billId } });
    const rows = names
      .map((name) => {
        const committeeId = committeeIndex.get(name.toLowerCase().trim());
        return committeeId
          ? { billId, legislativeCommitteeId: committeeId }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      await this.db.billCommitteeAssignment.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  }

  private async linkBillVotes(
    billId: string,
    votes: Bill['votes'],
    repIndex: Map<string, { id: string; chamber: string }>,
    sourceUrl: string,
  ): Promise<void> {
    if (votes.length === 0) return;
    await this.db.billVote.deleteMany({ where: { billId } });
    const rows = votes
      .filter((v) => v.representativeName && v.position)
      .map((v) => {
        const voteDate =
          v.voteDate instanceof Date
            ? v.voteDate
            : new Date(v.voteDate as unknown as string);
        return {
          billId,
          representativeId:
            this.resolveRepByName(v.representativeName!, repIndex) ?? null,
          representativeName: v.representativeName!,
          chamber: v.chamber,
          voteDate,
          position: v.position,
          motionText: v.motionText ?? null,
          sourceUrl,
        };
      });
    if (rows.length > 0) {
      await this.db.billVote.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // ─── Civics sync helpers ──────────────────────────────────────────────────────

  private async crawlCivicsUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
  ): Promise<string[]> {
    const depth = ds.crawlDepth ?? 0;
    const maxPages = ds.crawlMaxPages ?? 20;

    const seed = this.canonicalizeUrl(ds.url);
    const seedUrl = new URL(seed);

    if (
      seedUrl.protocol !== 'https:' ||
      !registeredHosts.has(seedUrl.hostname)
    ) {
      this.logger.error(
        `Civics crawl rejected: ${seedUrl.hostname} is not a registered data source host or is non-HTTPS`,
      );
      return [];
    }

    const pathPrefix = seedUrl.pathname.replace(/[^/]*$/, '');
    const inScope = (u: string): boolean => {
      try {
        const parsed = new URL(u);
        return (
          parsed.host === seedUrl.host && parsed.pathname.startsWith(pathPrefix)
        );
      } catch {
        return false;
      }
    };

    const visited = new Set<string>([seed]);
    const order: string[] = [seed];
    const queue: { url: string; depth: number }[] = [{ url: seed, depth: 0 }];

    while (queue.length > 0 && order.length < maxPages) {
      const { url, depth: d } = queue.shift()!;
      if (d >= depth) continue;
      let html: string;
      try {
        html = await this.fetchUrlText(url);
      } catch (e) {
        this.logger.warn(
          `Civics crawl: fetch failed for ${url}: ${(e as Error).message}`,
        );
        continue;
      }
      for (const link of this.extractLinks(url, html)) {
        const canonical = this.canonicalizeUrl(link);
        if (visited.has(canonical) || !inScope(canonical)) continue;
        visited.add(canonical);
        order.push(canonical);
        queue.push({ url: canonical, depth: d + 1 });
        if (order.length >= maxPages) break;
      }
    }
    return order;
  }

  private canonicalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = '';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  private extractLinks(baseUrl: string, html: string): string[] {
    const out: string[] = [];
    const re = /<a\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1].trim().replace(/&amp;/g, '&');
      if (
        !href ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('#')
      ) {
        continue;
      }
      try {
        out.push(new URL(href, baseUrl).toString());
      } catch {
        // skip malformed
      }
    }
    return out;
  }

  private async extractAndUpsertCivicsPage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
  ): Promise<'created' | 'updated' | 'failed'> {
    if (!this.promptClient || !this.llm) return 'failed';
    try {
      const html = await this.fetchUrlText(sourceUrl);
      const content = this.htmlToReadableText(html);
      const { promptText, promptHash, promptVersion } =
        await this.promptClient.getCivicsExtractionPrompt({
          regionId,
          sourceUrl,
          contentGoal: ds.contentGoal,
          category: ds.category,
          hints: ds.hints,
          html: content,
        });

      const result = await this.llm.generate(promptText, {
        maxTokens: ds.llmMaxTokens ?? 32000,
        temperature: 0.1,
        requestTimeoutMs: ds.llmRequestTimeoutMs,
      });

      const candidate = extractJsonObjectSlice(result.text);
      if (!candidate) {
        this.logger.warn(
          `Civics extraction: no JSON object for ${sourceUrl} (${result.text.length} chars)`,
        );
        return 'failed';
      }

      let block: Partial<{
        chambers: unknown;
        measureTypes: unknown;
        lifecycleStages: unknown;
        sessionScheme: unknown;
        glossary: unknown;
      }>;
      try {
        block = JSON.parse(candidate) as typeof block;
      } catch (e) {
        this.logger.warn(
          `Civics extraction: JSON.parse failed for ${sourceUrl}: ${(e as Error).message}`,
        );
        return 'failed';
      }

      const existing = await this.db.civicsBlock.findUnique({
        where: { regionId_sourceUrl: { regionId, sourceUrl } },
        select: { id: true },
      });

      const fields = {
        chambers: this.toJsonField(block.chambers),
        measureTypes: this.toJsonField(block.measureTypes),
        lifecycleStages: this.toJsonField(block.lifecycleStages),
        sessionScheme: this.toJsonField(block.sessionScheme),
        glossary: this.toJsonField(block.glossary),
      };

      await this.db.civicsBlock.upsert({
        where: { regionId_sourceUrl: { regionId, sourceUrl } },
        create: {
          regionId,
          sourceUrl,
          ...fields,
          promptHash,
          promptVersion,
          extractedAt: new Date(),
        },
        update: {
          ...fields,
          promptHash,
          promptVersion,
          extractedAt: new Date(),
        },
      });

      const glossaryUpserted = await this.upsertGlossaryEntries(
        regionId,
        sourceUrl,
        block.glossary,
        promptHash,
        promptVersion,
      );

      const outcome = existing ? 'updated' : 'created';
      this.logger.log(
        `Civics extracted from ${sourceUrl} (${outcome}, ${glossaryUpserted} glossary terms)`,
      );
      return outcome;
    } catch (e) {
      this.logger.error(
        `Civics extraction failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return 'failed';
    }
  }

  private async upsertGlossaryEntries(
    regionId: string,
    sourceUrl: string,
    glossary: unknown,
    promptHash: string | undefined,
    promptVersion: string | undefined,
  ): Promise<number> {
    if (!Array.isArray(glossary) || glossary.length === 0) return 0;
    const valid = glossary.filter(
      (
        e,
      ): e is { term: string; slug: string; definition: unknown } & Record<
        string,
        unknown
      > =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).term === 'string' &&
        typeof (e as Record<string, unknown>).slug === 'string' &&
        !!(e as Record<string, unknown>).definition,
    );
    if (valid.length < glossary.length) {
      this.logger.debug(
        `Glossary upsert: dropped ${glossary.length - valid.length} malformed entries from ${sourceUrl}`,
      );
    }
    const now = new Date();
    await batchTransaction(
      this.db,
      valid.map((entry) =>
        this.db.glossaryEntry.upsert({
          where: { regionId_slug: { regionId, slug: entry.slug } },
          create: {
            regionId,
            term: entry.term,
            slug: entry.slug,
            definition: entry.definition as Prisma.InputJsonValue,
            longDefinition: this.toJsonField(entry.longDefinition),
            relatedTerms: Array.isArray(entry.relatedTerms)
              ? (entry.relatedTerms as string[]).filter(
                  (t) => typeof t === 'string',
                )
              : [],
            sourceUrl,
            promptHash,
            promptVersion,
            extractedAt: now,
          },
          update: {
            term: entry.term,
            definition: entry.definition as Prisma.InputJsonValue,
            longDefinition: this.toJsonField(entry.longDefinition),
            relatedTerms: Array.isArray(entry.relatedTerms)
              ? (entry.relatedTerms as string[]).filter(
                  (t) => typeof t === 'string',
                )
              : [],
            sourceUrl,
            promptHash,
            promptVersion,
            extractedAt: now,
          },
        }),
      ),
    );
    return valid.length;
  }

  /**
   * Throttled + retried HTML fetch. Wraps `fetchTextWithRetry` from
   * `./resilient-fetch` so all per-bill / per-page fetches honor the
   * shared per-host gap and back off on 5xx / 429 / timeouts before
   * giving up. See opuspopuli#730.
   */
  private async fetchUrlText(url: string): Promise<string> {
    return fetchTextWithRetry(url, {
      timeoutMs: 20_000,
      throttle: this.hostThrottle,
      logger: this.logger,
    });
  }

  private htmlToReadableText(html: string): string {
    let s = html;
    s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '');
    s = s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '');
    s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
    s = s.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<[^>]+>/g, ' ');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    s = s
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    return s;
  }

  private toJsonField(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.DbNull {
    return value === undefined || value === null
      ? Prisma.DbNull
      : (value as Prisma.InputJsonValue);
  }

  // ─── Campaign finance helpers ─────────────────────────────────────────────────

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
}

// ─── Module-level utility (needed by both sync + other helpers) ───────────────

function deriveDistrictFromExternalId(externalId: string): string | undefined {
  const last = externalId.split('-').at(-1);
  if (!last || !/^\d+$/.test(last)) return undefined;
  return String(Number.parseInt(last, 10));
}
