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
import {
  PromptClientService,
  type LifecycleStageInput,
} from '@opuspopuli/prompt-client';
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
import {
  billSyncTracker,
  repSyncTracker,
  meetingSyncTracker,
  minutesSyncTracker,
  propositionSyncTracker,
  civicsSyncTracker,
  campaignFinanceSyncTracker,
  type SyncPhaseTracker,
  type BillSyncPhase,
  type CampaignFinanceSyncPhase,
} from './sync-phase-logger';

/**
 * Parse "AB 96" out of the externalId "202520260AB96" (CA leginfo format)
 * so per-item log lines can show the operator-readable bill number even
 * before the page content has been fetched / parsed. Returns null when
 * the pattern doesn't match — the per-item line falls back to "--".
 */
/**
 * Pull the plain-language reading out of a CivicText-shaped JSONB blob
 * ({ verbatim, plainLanguage }). Empty string when the field is missing
 * or malformed — callers decide whether to substitute a fallback. Used
 * to build per-region taxonomy inputs for the bill-status-summary
 * prompt (#823).
 */
/**
 * Parse the merged status-summary `status.lastActionDate` (ISO YYYY-MM-DD
 * or null) into the value to write back to `bills.lastActionDate`.
 *
 * Returns:
 *   - a Date when the string parses cleanly
 *   - null when the LLM explicitly returned null (intentional clear)
 *   - undefined when the field was absent OR the string is unparseable —
 *     callers spread this with `...(date !== undefined ? { lastActionDate: date } : {})`
 *     so the existing column value is preserved instead of being clobbered
 *     with null.
 */
function parseLastActionDate(
  raw: string | null | undefined,
): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function extractPlainLanguage(field: unknown): string {
  if (!field || typeof field !== 'object') return '';
  const plain = (field as Record<string, unknown>)['plainLanguage'];
  return typeof plain === 'string' ? plain : '';
}

function billNumberFromExternalId(
  externalId: string | undefined,
): string | null {
  if (!externalId) return null;
  // Trailing alphabetic measure code (AB, SB, ACA, SCR, AJR, SJR, ...)
  // + trailing decimal number. Anchored to end so we don't accidentally
  // match the session-year digits.
  const m = externalId.match(/([A-Z]{1,4})(\d+)$/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

/**
 * Map the enrich-single-bill result onto a phase tracker outcome shape.
 * Lifted to a named helper so the call site avoids two nested ternaries
 * (one for label, one for counter bucket) — sonarjs/no-nested-conditional
 * trips on the inline form.
 */
function describeEnrichmentResult(
  outcome: 'enriched' | 'skipped' | 'failed',
  tokensUsed: number,
): {
  outcomeLabel: string;
  outcome: 'created' | 'updated' | 'skipped' | 'error';
} {
  if (outcome === 'enriched') {
    return {
      outcomeLabel: `enriched (${tokensUsed} tokens)`,
      outcome: 'updated',
    };
  }
  if (outcome === 'skipped') {
    return { outcomeLabel: 'skipped: no fullTextUrl', outcome: 'skipped' };
  }
  return { outcomeLabel: 'failed', outcome: 'error' };
}

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
 *
 * Post-#823 this is the inner shape of `summary` on the merged
 * bill-status-summary response — preserved byte-for-byte so existing
 * consumers (bill-relevance-explanation #745, briefing UI) keep working
 * without coordinated changes.
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
 * Shape we expect from the merged bill-status-summary LLM response. The
 * `summary` block is structurally identical to {@link BillAiSummaryShape}
 * so the JSONB written to `bills.aiSummary` stays drop-in compatible with
 * existing consumers. The `status` block carries the LLM-classified stage
 * id (validated at runtime against the region's civics_blocks taxonomy)
 * + verbatim status text + last-action date + a short verbatim snippet.
 * See opuspopuli#823.
 */
interface BillStatusSummaryShape {
  status?: {
    raw?: string;
    /** A stage id from the region's lifecycleStages, or "unknown". */
    stage?: string;
    /** ISO YYYY-MM-DD; null when unparseable. */
    lastActionDate?: string | null;
    lastActionSnippet?: string | null;
  };
  summary?: BillAiSummaryShape;
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
    currentStageId: true;
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
    const regionId = provider.getName?.() ?? 'unknown';

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = propositionSyncTracker(this.logger, 'discover', 1, {
      region: regionId,
    });
    const propositions = await provider.fetchPropositions(pipelineJobId);
    discoverTracker.item({
      name: 'propositions provider',
      externalId: null,
      outcomeLabel: `${propositions.length} proposition(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    const stagePatterns = await this.buildStagePatterns(regionId);

    // ─── Phase 2/3 — extract_and_upsert ────────────────────────────
    // Pre-fetch existing externalIds so the per-item line can report
    // accurate created-vs-updated outcomes (and the phase-complete
    // counter matches reality). Without this, every row would log as
    // "updated" even though many are new. Costs one extra findMany
    // per sync — acceptable tradeoff for accurate observability.
    // Skip the pre-fetch entirely when there's nothing to look up.
    const existingPropIds = new Set<string>(
      propositions.length === 0
        ? []
        : (
            await this.db.proposition.findMany({
              where: {
                externalId: { in: propositions.map((p) => p.externalId) },
              },
              select: { externalId: true },
            })
          ).map((p: ExternalIdRecord) => p.externalId),
    );
    const extractTracker = propositionSyncTracker(
      this.logger,
      'extract_and_upsert',
      propositions.length,
      { region: regionId },
    );
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
          const isNew = !existingPropIds.has(prop.externalId);
          const verb = isNew ? 'created' : 'updated';
          const stageDesc = lifecycleStageId
            ? `stage=${lifecycleStageId}`
            : 'stage=unresolved';
          extractTracker.item({
            name: prop.externalId,
            externalId: prop.externalId,
            outcomeLabel: `${verb} (${stageDesc})`,
            outcome: verb,
          });
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
    extractTracker.complete();

    if (stagePatterns.length > 0) {
      await this.backfillPropositionStageIds(stagePatterns);
    }

    // ─── Phase 3/3 — analysis ──────────────────────────────────────
    const analysisTracker = propositionSyncTracker(
      this.logger,
      'analysis',
      this.propositionAnalysis ? 1 : 0,
      { region: regionId },
    );
    if (this.propositionAnalysis) {
      try {
        await this.propositionAnalysis.generateMissing();
        analysisTracker.item({
          name: 'propositionAnalysis.generateMissing',
          externalId: null,
          outcomeLabel: 'analysis pass complete',
          outcome: 'updated',
        });
      } catch (error) {
        analysisTracker.item({
          name: 'propositionAnalysis.generateMissing',
          externalId: null,
          outcomeLabel: `failed: ${(error as Error).message}`,
          outcome: 'error',
        });
        this.logger.warn(
          `Proposition analysis post-sync pass failed: ${(error as Error).message}`,
        );
      }
    }
    analysisTracker.complete();

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
    const regionId = provider.getName?.() ?? 'unknown';

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = meetingSyncTracker(this.logger, 'discover', 1, {
      region: regionId,
    });
    const meetings = await provider.fetchMeetings(pipelineJobId);
    discoverTracker.item({
      name: 'meetings provider',
      externalId: null,
      outcomeLabel: `${meetings.length} meeting(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    if (meetings.length === 0) {
      // Skip the empty extract+minutes_link phases for clarity.
      return this.syncMeetingMinutes(provider);
    }

    // ─── Phase 2/3 — extract_and_upsert ────────────────────────────
    // Pre-fetch existing externalIds so the per-item line can report
    // accurate created-vs-updated outcomes. Skip when there's nothing
    // to look up.
    const existingMeetingIds = new Set<string>(
      meetings.length === 0
        ? []
        : (
            await this.db.meeting.findMany({
              where: { externalId: { in: meetings.map((m) => m.externalId) } },
              select: { externalId: true },
            })
          ).map((m: ExternalIdRecord) => m.externalId),
    );
    const extractTracker = meetingSyncTracker(
      this.logger,
      'extract_and_upsert',
      meetings.length,
      { region: regionId },
    );
    const result = await this.upsertByExternalId(
      meetings,
      (ids) =>
        this.db.meeting.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (items) =>
        items.map((meeting) => {
          const isNew = !existingMeetingIds.has(meeting.externalId);
          extractTracker.item({
            name: meeting.title,
            externalId: meeting.externalId,
            outcomeLabel: isNew ? 'created' : 'updated',
            outcome: isNew ? 'created' : 'updated',
          });
          return this.db.meeting.upsert({
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
          });
        }),
      'meetings:',
    );
    extractTracker.complete();

    // ─── Phase 3/3 — minutes_link ──────────────────────────────────
    // minutes_link is a future phase (#814) that ties minutes rows to
    // their parent meeting via (body, date). Until that lands, this
    // tracker fires as a no-op marker so the operator sees the phase
    // even if it does nothing — and so dashboards / log queries that
    // expect all 3 phases stay correct.
    const linkTracker = meetingSyncTracker(this.logger, 'minutes_link', 0, {
      region: regionId,
      note: 'not-yet-implemented',
    });
    linkTracker.complete();

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
      // Emit phase markers even on the early-return path so the
      // operator can distinguish "phase ran and was empty" from
      // "phase never ran." Matches the pattern other syncs use for
      // not-yet-implemented sub-phases.
      const noProvider = minutesSyncTracker(this.logger, 'discover', 0, {
        note: 'provider does not implement fetchMeetingMinutes',
      });
      noProvider.complete();
      const noIngest = minutesSyncTracker(this.logger, 'ingest', 0);
      noIngest.complete();
      const noSummarize = minutesSyncTracker(this.logger, 'summarize', 0);
      noSummarize.complete();
      return { processed: 0, created: 0, updated: 0 };
    }

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = minutesSyncTracker(this.logger, 'discover', 1);
    const bundles = await provider.fetchMeetingMinutes();
    discoverTracker.item({
      name: 'minutes provider',
      externalId: null,
      outcomeLabel: `${bundles.length} minutes bundle(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    if (bundles.length === 0) {
      const ingestEmpty = minutesSyncTracker(this.logger, 'ingest', 0);
      ingestEmpty.complete();
      const summarizeEmpty = minutesSyncTracker(this.logger, 'summarize', 0);
      summarizeEmpty.complete();
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

    // ─── Phase 2/3 — ingest ────────────────────────────────────────
    const ingestTracker = minutesSyncTracker(
      this.logger,
      'ingest',
      bundles.length,
    );
    const upsertedIds: string[] = [];
    for (const { minutes } of bundles) {
      const wasExisting = existingExternalIds.has(minutes.externalId);
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
      ingestTracker.item({
        name: `${minutes.body} ${minutes.date.toISOString().slice(0, 10)}`,
        externalId: minutes.externalId,
        outcomeLabel: wasExisting
          ? `updated (rev=${minutes.revisionSeq})`
          : `created (${minutes.rawText?.length ?? 0} chars)`,
        outcome: wasExisting ? 'updated' : 'created',
      });

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
    ingestTracker.complete();

    if (upsertedIds.length > 0 && this.legislativeActionLinker) {
      await this.legislativeActionLinker.linkMinutes(upsertedIds);
    }

    // ─── Phase 3/3 — summarize ─────────────────────────────────────
    // AI synopsis generation is tracked in #813 and not yet wired —
    // tracker fires as a no-op marker so the operator sees the phase.
    const summarizeTracker = minutesSyncTracker(this.logger, 'summarize', 0, {
      note: 'MinutesSummaryService not yet implemented — see #813',
    });
    summarizeTracker.complete();

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
    const resolvedRegionId = regionId ?? provider.getName?.() ?? 'unknown';

    // ─── Phase 1/5 — discover ──────────────────────────────────────
    const discoverTracker = repSyncTracker(this.logger, 'discover', 1, {
      region: resolvedRegionId,
    });
    const reps = await provider.fetchRepresentatives();
    discoverTracker.item({
      name: 'representatives provider',
      externalId: null,
      outcomeLabel: `${reps.length} representative(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

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

    // ─── Phase 2/5 — extract_and_upsert ────────────────────────────
    // Pre-fetch existing externalIds so the per-item line can report
    // accurate created-vs-updated outcomes. Skip when there's nothing
    // to look up.
    const existingRepIds = new Set<string>(
      reps.length === 0
        ? []
        : (
            await this.db.representative.findMany({
              where: { externalId: { in: reps.map((r) => r.externalId) } },
              select: { externalId: true },
            })
          ).map((r: ExternalIdRecord) => r.externalId),
    );
    const extractTracker = repSyncTracker(
      this.logger,
      'extract_and_upsert',
      reps.length,
      { region: resolvedRegionId },
    );
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
          const isNew = !existingRepIds.has(rep.externalId);
          extractTracker.item({
            name: rep.name,
            externalId: rep.externalId,
            outcomeLabel: `${isNew ? 'created' : 'updated'} (chamber=${rep.chamber ?? 'unknown'}, district=${district})`,
            outcome: isNew ? 'created' : 'updated',
          });
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
    extractTracker.complete();

    // ─── Phase 3/5 — detail_crawl ──────────────────────────────────
    // Detail-page crawling for committees/contact info happens inside
    // the DeclarativeRegionPlugin.fetchRepresentatives call above —
    // it's not a separate orchestrator step in the current pipeline.
    // Phase fires as a marker so the operator sees all 5 phases.
    const detailCrawlTracker = repSyncTracker(this.logger, 'detail_crawl', 0, {
      region: resolvedRegionId,
      note: 'inlined into fetchRepresentatives at plugin layer',
    });
    detailCrawlTracker.complete();

    // ─── Phase 4/5 — bio_generation ────────────────────────────────
    const bioTracker = repSyncTracker(
      this.logger,
      'bio_generation',
      this.bioGenerator ? reps.length : 0,
      { region: resolvedRegionId },
    );
    if (this.bioGenerator) {
      await this.bioGenerator.enrichBios(reps, this.pluginRegionName, maxReps);
      // BioGeneratorService is opaque about per-rep outcomes from out
      // here — it logs its own per-rep DEBUG lines. We just record the
      // batch boundary as one aggregate item.
      bioTracker.note(`enrichBios pass complete for ${reps.length} reps`);
    }
    bioTracker.complete();

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

    // ─── Phase 5/5 — prune_stale ───────────────────────────────────
    // Stale-rep pruning isn't currently wired (reps don't go inactive
    // by data-source absence the way bills do — they leave office in
    // discrete elections). Marker for parity with bills' 6-phase
    // shape; tracked for actual implementation under #816 / #770
    // alongside the rep↔committee FK work.
    const pruneTracker = repSyncTracker(this.logger, 'prune_stale', 0, {
      region: resolvedRegionId,
      note: 'not-yet-implemented',
    });
    pruneTracker.complete();

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
    let batchCount = 0;

    // Campaign finance uses a streaming callback (CAL-ACCESS bulk
    // download → onBatch per chunk) rather than per-item iteration,
    // so observability lives at the batch level. Phase trackers are
    // initialized with total=0 and we use `note()` per batch instead
    // of `item()` per record — the dataset is too large to log every
    // contribution/expenditure individually.
    //
    // Phase 1 (discover) and Phase 2 (extract_and_upsert) are
    // intentionally constructed and completed sequentially. The
    // extract tracker is lazily initialized on the first onBatch
    // callback so the phase-start log line for Phase 2 lands AFTER
    // Phase 1's complete line — operator-readable phase ordering.
    const discoverTracker = campaignFinanceSyncTracker(
      this.logger,
      'discover',
      0,
    );
    discoverTracker.note('preparing CAL-ACCESS bulk download stream');

    // Use a single-property ref so TypeScript can't narrow the inner
    // type to `never` after the if-check below — closures that mutate
    // a captured `let` variable defeat TS's flow analysis. The ref
    // pattern sidesteps that without sprinkling `!` assertions.
    const extractRef: {
      tracker: SyncPhaseTracker<CampaignFinanceSyncPhase> | null;
    } = { tracker: null };
    const ensureExtractTracker =
      (): SyncPhaseTracker<CampaignFinanceSyncPhase> => {
        if (!extractRef.tracker) {
          // First batch arrived → discover phase is functionally done.
          discoverTracker.complete();
          extractRef.tracker = campaignFinanceSyncTracker(
            this.logger,
            'extract_and_upsert',
            0,
          );
        }
        return extractRef.tracker;
      };

    const onBatch = async (items: Record<string, unknown>[]) => {
      const tracker = ensureExtractTracker();
      const batchData = this.sortCampaignFinanceItems(items);
      await this.ensureCommitteeStubs(batchData);
      const result = await this.upsertCampaignFinanceBatch(batchData);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
      batchCount++;
      tracker.note(
        `batch ${batchCount}: ${result.processed} items (${result.created} created, ${result.updated} updated)`,
      );
    };

    const data = await provider.fetchCampaignFinance(onBatch, pipelineJobId);

    if (
      data.contributions.length > 0 ||
      data.expenditures.length > 0 ||
      data.independentExpenditures.length > 0 ||
      data.committeeMeasureFilings.length > 0
    ) {
      const tracker = ensureExtractTracker();
      await this.ensureCommitteeStubs(data);
      const result = await this.upsertCampaignFinanceBatch(data);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
      tracker.note(
        `final flush: ${result.processed} items (${result.created} created, ${result.updated} updated)`,
      );
    }

    // Either the lazy ensureExtractTracker() ran (and started phase 2
    // after completing phase 1), or no batches ever arrived. In the
    // latter case close phase 1 now and emit an empty phase 2 marker
    // so the operator sees both phase boundaries regardless of data.
    if (extractRef.tracker) {
      extractRef.tracker.complete();
    } else {
      discoverTracker.complete();
      const emptyExtractTracker = campaignFinanceSyncTracker(
        this.logger,
        'extract_and_upsert',
        0,
        { note: 'no data from provider' },
      );
      emptyExtractTracker.complete();
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

    // ─── Phase 1/2 — discover ──────────────────────────────────────
    const discoverTracker = civicsSyncTracker(
      this.logger,
      'discover',
      dataSources.length,
      { region: regionId },
    );
    const allUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    for (const ds of dataSources) {
      const urls = await this.crawlCivicsUrls(ds, registeredHosts);
      discoverTracker.item({
        name: ds.url,
        externalId: null,
        outcomeLabel: `${urls.length} page(s) at depth ${ds.crawlDepth ?? 0}`,
        outcome: 'updated',
      });
      for (const url of urls) allUrls.push({ url, ds });
    }
    discoverTracker.complete();

    // ─── Phase 2/2 — extract_and_upsert ────────────────────────────
    const extractTracker = civicsSyncTracker(
      this.logger,
      'extract_and_upsert',
      allUrls.length,
      { region: regionId },
    );
    for (const { url, ds } of allUrls) {
      const result = await this.extractAndUpsertCivicsPage(regionId, url, ds);
      if (result === 'created') {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'created',
          outcome: 'created',
        });
        created++;
        processed++;
      } else if (result === 'updated') {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'updated',
          outcome: 'updated',
        });
        updated++;
        processed++;
      } else if (result === 'failed') {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'failed',
          outcome: 'error',
        });
      } else {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'skipped',
          outcome: 'skipped',
        });
      }
    }
    extractTracker.complete();

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

    this.applyBillsHostThrottle(dataSources);

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

    // ─── Phase 1/6 — discover ───────────────────────────────────────
    // Walk every data source's discovery index up-front so phase 2/3
    // can announce a real grand-total. Otherwise the per-source
    // interleaving would force the operator to mentally sum partial
    // counts.
    const discoverTracker = billSyncTracker(
      this.logger,
      'discover',
      dataSources.length,
      { region: regionId },
    );
    const allStatusUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    const allVotesUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    for (const ds of dataSources) {
      const { statusUrls, votesUrls } = await this.discoverBillUrls(
        ds,
        registeredHosts,
        maxBills,
      );
      discoverTracker.item({
        name: ds.url,
        externalId: null,
        outcomeLabel: `${statusUrls.length} status URL(s), ${votesUrls.length} votes-only URL(s)`,
        outcome: 'updated',
      });
      for (const url of statusUrls) allStatusUrls.push({ url, ds });
      for (const url of votesUrls) allVotesUrls.push({ url, ds });
    }
    discoverTracker.complete();

    // ─── Phase 2/6 — extract_and_upsert ─────────────────────────────
    const extractTracker = billSyncTracker(
      this.logger,
      'extract_and_upsert',
      allStatusUrls.length,
      { region: regionId },
    );
    for (const { url, ds } of allStatusUrls) {
      await this.processOneBillUrl(url, {
        regionId,
        ds,
        repIndex,
        committeeIndex,
        stagePatterns,
        billsByExternalId,
        forceStatusRecheck,
        syncedExternalIds,
        tracker: extractTracker,
      });
    }
    const extractCounts = extractTracker.complete();
    processed +=
      extractCounts.created + extractCounts.updated + extractCounts.skipped;
    created += extractCounts.created;
    updated += extractCounts.updated;
    skippedTotal += extractCounts.skipped;

    // ─── Phase 3/6 — votes_only ─────────────────────────────────────
    const votesTracker = billSyncTracker(
      this.logger,
      'votes_only',
      allVotesUrls.length,
      { region: regionId },
    );
    for (const { url, ds } of allVotesUrls) {
      const externalId = this.safeBillIdFromUrl(url) ?? null;
      const billNumber = billNumberFromExternalId(externalId ?? undefined);
      const result = await this.extractVotesOnlyPage(
        regionId,
        url,
        ds,
        repIndex,
      );
      if (result === 'updated') {
        votesTracker.item({
          name: billNumber,
          externalId,
          outcomeLabel: 'votes upserted',
          outcome: 'updated',
        });
        updated++;
      } else {
        // Most votes URLs land on bills without a shell yet — log them
        // as itemUnknown so the count stays visible in the summary.
        votesTracker.itemUnknown(
          `no bill shell yet for ${externalId ?? 'unknown'}`,
          externalId,
        );
      }
    }
    votesTracker.complete();

    // ─── Phase 4/6 — stage_backfill ────────────────────────────────
    if (stagePatterns.length > 0) {
      await this.backfillBillStageIds(regionId, stagePatterns);
    }

    // ─── Phase 5/6 — prune_stale ───────────────────────────────────
    await this.pruneStaleBills(regionId, syncedExternalIds, maxBills);

    // ─── Phase 6/6 — summarize ─────────────────────────────────────
    // Enrichment is a second pass: extraction (above) is the prerequisite,
    // but enrichment can be re-run independently when the bill-status-summary
    // prompt template version bumps (see #823, #741). Bounded by maxBills.
    //
    // Post-#823: the merged call needs the region's lifecycle taxonomy so
    // the LLM can classify the stage in-band (replacing the 92%-miss
    // deterministic pattern matcher). Built here so we pay the civics-data
    // read once per sync rather than per-bill.
    const lifecycleStages = await this.buildLifecycleStageInputs(regionId);
    await this.enrichBillSummaries(
      regionId,
      stagePatterns,
      lifecycleStages,
      maxBills,
    );

    return { processed, created, updated, skipped: skippedTotal };
  }

  /**
   * Apply per-source rate limits to the shared host throttle. Each bills
   * data source may override the default 1 req/sec gap via
   * DataSourceConfig.rateLimitOverride (requests/sec). The override
   * applies to the source's hostname, which transitively covers the
   * status / votes / text page templates (all on the same host).
   *
   * Extracted from `syncBills` to keep that function under SonarCloud's
   * cognitive-complexity gate. Try/catch on URL parsing isolates a
   * malformed-URL failure from interrupting the throttle setup for
   * other sources.
   */
  private applyBillsHostThrottle(dataSources: DataSourceConfig[]): void {
    for (const ds of dataSources) {
      if (!ds.rateLimitOverride || ds.rateLimitOverride <= 0) continue;
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

  /**
   * Process a single bill discovery URL: try the cheap status-only
   * re-check first, then fall through to the full LLM extraction.
   * Emits one per-item log line via the tracker and mutates the shared
   * `syncedExternalIds` set in place.
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
      tracker: SyncPhaseTracker<BillSyncPhase>;
    },
  ): Promise<void> {
    const billId = this.safeBillIdFromUrl(url);
    const billNumber = billNumberFromExternalId(billId);

    // Status-only re-check path (#819, generalizing #689): fires for every
    // bill with a prior DB row, not just journal-flagged ones. Unchanged →
    // skip cheaply (no LLM, just an `updated_at` touch); otherwise fall
    // through to the full extract path. `forceStatusRecheck=true` bypasses
    // the cheap parse and forces LLM re-extraction.
    if (billId) {
      const recheck = await this.tryStatusOnlyRecheck(
        url,
        ctx.forceStatusRecheck,
        ctx.billsByExternalId.get(billId),
      );
      if (recheck === 'unchanged') {
        ctx.tracker.item({
          name: billNumber,
          externalId: billId,
          outcomeLabel: 'status-only matched (no LLM)',
          outcome: 'skipped',
          extraCounters: ['status-only matched'],
        });
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
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'created (LLM)',
        outcome: 'created',
      });
    } else if (result === 'updated') {
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'updated (LLM)',
        outcome: 'updated',
      });
    } else if (result === 'skipped') {
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'skipped',
        outcome: 'skipped',
      });
    } else {
      // result === 'failed'
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'failed',
        outcome: 'error',
      });
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
   * Internal helper to load civics data for bill stage pattern compilation
   * and (post-#823) for the merged bill-status-summary prompt's per-region
   * taxonomy. Reads directly from DB without caching so sync always uses
   * fresh data.
   *
   * `name` and `description` are extracted from `name.plainLanguage` and
   * `shortDescription.plainLanguage` respectively — see the CivicText
   * shape in region-query.service.ts. Both fall back to empty strings
   * when the upstream civics extraction didn't populate them.
   */
  private async getCivicsDataForSync(regionId: string): Promise<{
    lifecycleStages: Array<{
      id: string;
      name: string;
      description: string;
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
      {
        id: string;
        name: string;
        description: string;
        statusStringPatterns: string[];
      }
    >();
    for (const row of rows) {
      const rawL = row.lifecycleStages as Record<string, unknown>[] | null;
      if (!rawL) continue;
      for (const ls of rawL) {
        const id = String(ls['id'] ?? '');
        if (!id || lifecycleStages.has(id)) continue;
        lifecycleStages.set(id, {
          id,
          name: extractPlainLanguage(ls['name']),
          description: extractPlainLanguage(ls['shortDescription']),
          statusStringPatterns: Array.isArray(ls['statusStringPatterns'])
            ? (ls['statusStringPatterns'] as string[])
            : [],
        });
      }
    }
    if (lifecycleStages.size === 0) return null;
    return { lifecycleStages: Array.from(lifecycleStages.values()) };
  }

  /**
   * Build the per-region lifecycle taxonomy input the merged
   * bill-status-summary prompt expects (opuspopuli#823). The LLM picks
   * one `id` from this list (or returns `"unknown"`); the caller
   * validates the returned id against this set before writing it to
   * `bills.current_stage_id`.
   *
   * Returns `null` when the region has no civics_blocks taxonomy yet —
   * callers should skip the merged enrichment path in that case (we'd
   * have nothing to classify into). Civic data onboarding is a hard
   * prerequisite of the new path; documenting that as a setup step
   * beats silently regressing to a fixed enum.
   */
  private async buildLifecycleStageInputs(
    regionId: string,
  ): Promise<LifecycleStageInput[] | null> {
    const civics = await this.getCivicsDataForSync(regionId);
    if (!civics || civics.lifecycleStages.length === 0) return null;
    return civics.lifecycleStages.map((s) => ({
      id: s.id,
      name: s.name || s.id,
      description: s.description || `Stage ${s.id}.`,
    }));
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
      select: { id: true, status: true, billNumber: true, externalId: true },
    });

    const tracker = billSyncTracker(
      this.logger,
      'stage_backfill',
      unmatched.length,
      {
        region: regionId,
      },
    );
    if (unmatched.length === 0) {
      tracker.complete();
      return;
    }

    const byStage = new Map<string, Array<(typeof unmatched)[number]>>();
    for (const bill of unmatched) {
      const stageId = this.resolveStageFromStatus(bill.status, stagePatterns);
      if (!stageId) {
        tracker.item({
          name: bill.billNumber,
          externalId: bill.externalId,
          outcomeLabel: 'unresolved (no pattern matched)',
          outcome: 'skipped',
        });
        continue;
      }
      if (!byStage.has(stageId)) byStage.set(stageId, []);
      byStage.get(stageId)!.push(bill);
    }

    for (const [stageId, bills] of byStage) {
      await this.db.bill.updateMany({
        where: { id: { in: bills.map((b) => b.id) } },
        data: { currentStageId: stageId },
      });
      for (const bill of bills) {
        tracker.item({
          name: bill.billNumber,
          externalId: bill.externalId,
          outcomeLabel: `stage=${stageId}`,
          outcome: 'updated',
        });
      }
    }
    tracker.complete();
  }

  private async pruneStaleBills(
    regionId: string,
    syncedExternalIds: Set<string>,
    maxBills?: number,
  ): Promise<void> {
    if (syncedExternalIds.size === 0 || maxBills != null) {
      // Tracker still useful so the operator sees the no-op outcome
      // rather than wondering whether the phase ran at all.
      const tracker = billSyncTracker(this.logger, 'prune_stale', 0, {
        region: regionId,
        reason:
          syncedExternalIds.size === 0
            ? 'no-synced-ids'
            : 'maxBills-set-skips-prune',
      });
      tracker.complete();
      return;
    }

    const stale = await this.db.bill.findMany({
      where: {
        regionId,
        externalId: { notIn: Array.from(syncedExternalIds) },
      },
      select: { id: true, billNumber: true, externalId: true },
    });

    const tracker = billSyncTracker(this.logger, 'prune_stale', stale.length, {
      region: regionId,
    });
    if (stale.length === 0) {
      tracker.complete();
      return;
    }

    await this.db.bill.deleteMany({
      where: { id: { in: stale.map((b) => b.id) } },
    });
    for (const bill of stale) {
      tracker.item({
        name: bill.billNumber,
        externalId: bill.externalId,
        outcomeLabel: 'removed (not seen in this sync)',
        outcome: 'updated',
      });
    }
    tracker.complete();
  }

  /**
   * Enrich un-summarized bills with structured AI summaries from the
   * merged bill-status-summary prompt-service endpoint (#823). Runs as a
   * second pass after `syncBills` so extraction stays decoupled from
   * summarization — a new prompt-template version triggers re-enrichment
   * without re-extracting.
   *
   * Per #823 the LLM call now also re-classifies the bill's lifecycle
   * stage (status.stage), overwriting whatever the pattern matcher set.
   * Stage coverage rises from 8% (pattern-match only) → ~95%+ (LLM with
   * the region taxonomy in context).
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
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[] | null,
    maxBills?: number,
  ): Promise<{ enriched: number; skipped: number; failed: number }> {
    if (!this.promptClient || !this.llm) {
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    // Civics-data taxonomy is a hard prerequisite for the merged call —
    // the LLM has nothing to classify into without it. Onboarding a new
    // region means seeding civics_blocks before bills enrichment.
    if (!lifecycleStages || lifecycleStages.length === 0) {
      this.logger.warn(
        `Bill enrichment ${regionId}: skipping summarize phase — no civics_blocks.lifecycleStages taxonomy. Run a civics-extraction sync first.`,
      );
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
        currentStageId: true,
      },
      take: maxBills,
    });

    const tracker = billSyncTracker(
      this.logger,
      'summarize',
      candidates.length,
      { region: regionId },
    );
    if (candidates.length === 0) {
      tracker.complete();
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    const counts = { enriched: 0, skipped: 0, failed: 0 };
    let totalTokens = 0;
    const startMs = Date.now();

    const stageIdSet = new Set(lifecycleStages.map((s) => s.id));
    for (const bill of candidates) {
      const result = await this.enrichSingleBill(
        bill,
        stagePatterns,
        lifecycleStages,
        stageIdSet,
      );
      counts[result.outcome] += 1;
      totalTokens += result.tokensUsed;
      const { outcomeLabel, outcome } = describeEnrichmentResult(
        result.outcome,
        result.tokensUsed,
      );
      tracker.item({
        name: bill.billNumber,
        externalId: null,
        outcomeLabel,
        outcome,
      });
    }

    const totalDurationMs = Date.now() - startMs;
    tracker.complete();
    // Structured telemetry retained alongside the human-readable phase
    // log so the existing dashboards / log queries keep working.
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

  private async enrichSingleBill(
    bill: BillEnrichmentCandidate,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[],
    stageIdSet: Set<string>,
  ): Promise<{
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
      const html = this.htmlToReadableText(
        await this.fetchUrlText(bill.fullTextUrl),
      );

      const { promptText, promptVersion } =
        await this.promptClient!.getBillStatusSummaryPrompt({
          regionId: bill.regionId,
          billNumber: bill.billNumber,
          sessionYear: bill.sessionYear,
          title: bill.title,
          html,
          lifecycleStages,
          priorStatus: bill.status ?? undefined,
          priorStage: bill.currentStageId ?? undefined,
        });

      const llmStart = Date.now();
      const llmResult = await this.llm!.generate(promptText, {
        maxTokens: 2000,
        temperature: 0.1,
      });
      const llmMs = Date.now() - llmStart;
      const tokensUsed = llmResult.tokensUsed ?? 0;

      const parsed = this.parseStatusSummaryResponse(
        llmResult.text,
        bill.billNumber,
      );
      if (!parsed) {
        return { outcome: 'failed', tokensUsed };
      }

      await this.writeStatusSummary(
        bill,
        parsed,
        promptVersion,
        stagePatterns,
        stageIdSet,
      );

      this.logger.debug(
        {
          event: 'bill_enrichment',
          billId: bill.id,
          billNumber: bill.billNumber,
          promptVersion,
          tokensUsed,
          latencyMs: llmMs,
          llmSkip: parsed.skip === true,
        },
        `Bill enrichment ok: ${bill.billNumber} ${promptVersion} tokens=${tokensUsed} ms=${llmMs}`,
      );

      return { outcome: 'enriched', tokensUsed };
    } catch (e) {
      this.logger.warn(
        `Bill enrichment failed for ${bill.billNumber}: ${(e as Error).message}`,
      );
      return { outcome: 'failed', tokensUsed: 0 };
    }
  }

  /**
   * Parse the merged bill-status-summary LLM response. Returns null when
   * the payload is missing/non-object/array — caller treats that as
   * `failed` so the bill stays eligible for the next sync (its
   * `aiSummary` column remains NULL).
   */
  private parseStatusSummaryResponse(
    text: string,
    billNumber: string,
  ): BillStatusSummaryShape | null {
    const candidate = extractJsonObjectSlice(text);
    if (!candidate) {
      this.logger.warn(`Bill enrichment: no JSON returned for ${billNumber}`);
      return null;
    }
    const raw: unknown = JSON.parse(candidate);
    // Reject non-object payloads — the LLM occasionally returns `null` or
    // `[]` instead of the structured object. Storing those would lock the
    // bill out of the retry query (`ai_summary IS NULL`) with garbage in
    // the column. Counted as failed → retried next sync.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.logger.warn(
        `Bill enrichment: non-object JSON payload for ${billNumber}`,
      );
      return null;
    }
    return raw as BillStatusSummaryShape;
  }

  /**
   * Apply the merged response to the bill row:
   *   - `{ skip: true }` → store the sentinel verbatim in `aiSummary` so
   *     the bill stops cycling through enrichment on every sync (mirrors
   *     the pre-#823 behavior).
   *   - Otherwise → write the `summary` JSONB (drop-in shape for existing
   *     consumers), the verbatim `status.raw`, a runtime-validated
   *     `currentStageId`, and the parsed `lastActionDate`. When the LLM
   *     reports `status.changed === false` we still write because this
   *     bill arrived here via `ai_summary IS NULL` — the changed flag
   *     just disambiguates intent for future re-enrich loops.
   */
  private async writeStatusSummary(
    bill: BillEnrichmentCandidate,
    parsed: BillStatusSummaryShape,
    promptVersion: string,
    stagePatterns: StagePattern[],
    stageIdSet: Set<string>,
  ): Promise<void> {
    if (parsed.skip === true) {
      await this.db.bill.update({
        where: { id: bill.id },
        data: {
          aiSummary: { skip: true } as Prisma.InputJsonValue,
          aiSummaryVersion: promptVersion,
          aiSummaryGeneratedAt: new Date(),
        },
      });
      return;
    }

    const summary: BillAiSummaryShape = parsed.summary ?? {};
    const status = parsed.status ?? {};
    const validatedStage = this.validateStageId(
      status.stage,
      status.raw,
      bill,
      stagePatterns,
      stageIdSet,
    );
    const lastActionDate = parseLastActionDate(status.lastActionDate);

    await this.db.bill.update({
      where: { id: bill.id },
      data: {
        aiSummary: summary as Prisma.InputJsonValue,
        aiSummaryVersion: promptVersion,
        aiSummaryGeneratedAt: new Date(),
        ...(status.raw ? { status: status.raw } : {}),
        // status.lastActionSnippet is the LLM's fresh read of the most
        // recent history entry; writing it keeps bills.lastAction in sync
        // with the merged-call view rather than letting the bill-extraction
        // value drift.
        ...(status.lastActionSnippet
          ? { lastAction: status.lastActionSnippet }
          : {}),
        currentStageId: validatedStage,
        ...(lastActionDate !== undefined ? { lastActionDate } : {}),
      },
    });
  }

  /**
   * Resolve the stage id we'll write to the bill row. Trust the LLM's
   * classification when it lands inside the region's taxonomy; otherwise
   * fall back to the deterministic pattern matcher.
   *
   * Logging is split by level so post-launch alerting has a clean drift
   * signal:
   *   - `"unknown"` is the documented "no stage fits" answer — expected
   *     for bills mid-paperwork — and logs at debug.
   *   - An out-of-taxonomy id is a prompt-template / model-drift signal
   *     and logs at warn so log-based alerts can target it.
   *
   * Returns `null` when neither the LLM nor the pattern matcher resolves —
   * the column stays NULL and the bill is eligible for the next sync.
   */
  private validateStageId(
    llmStage: string | undefined,
    statusRaw: string | undefined,
    bill: BillEnrichmentCandidate,
    stagePatterns: StagePattern[],
    stageIdSet: Set<string>,
  ): string | null {
    if (llmStage && llmStage !== 'unknown' && stageIdSet.has(llmStage)) {
      return llmStage;
    }
    const fallback = this.resolveStageFromStatus(
      statusRaw ?? bill.status,
      stagePatterns,
    );
    const outOfTaxonomy = llmStage !== undefined && llmStage !== 'unknown';
    const logPayload = {
      event: 'bill_stage_resolution_fallback',
      billId: bill.id,
      billNumber: bill.billNumber,
      regionId: bill.regionId,
      llmStage: llmStage ?? null,
      outOfTaxonomy,
      fallback: fallback ?? null,
    };
    const logMessage = `Bill ${bill.billNumber}: stage fallback (llmStage=${llmStage ?? 'null'}) → ${fallback ?? 'null'}`;
    if (outOfTaxonomy) {
      // Drift signal — alertable.
      this.logger.warn(logPayload, logMessage);
    } else {
      // Expected sometimes ("unknown" from the LLM, or absent stage field) —
      // visible at debug only so it doesn't drown the drift signal.
      this.logger.debug(logPayload, logMessage);
    }
    return fallback;
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
   * Status-only re-check for every bill with a prior DB row (#819,
   * generalizing #689). Fetches the status page, parses lastAction +
   * lastActionDate cheaply (no LLM), and skips the full extract path
   * when neither has moved. The LLM-normalized `status` field is
   * intentionally NOT compared — the LLM rewrites the raw leginfo
   * status ("Inactive Bill - Chaptered" → "Chaptered") so a raw-vs-
   * normalized comparison would false-positive every time.
   *
   * Coverage: pre-#819 this only fired for bills flagged by the
   * journal linker (`needsStatusRecheck=true`) or the weekly backstop.
   * Unflagged bills fell to the text-page `sourcePublishedAt` skip
   * (Mechanism B) — which silently missed status-only changes (e.g.
   * committee amendments) that didn't re-publish the bill text.
   * Removing the flag gate closes that silent-drift gap; the existing
   * `needsStatusRecheck` flag is retained as documentation (journal
   * linker still sets it; the clear-after-skip path still clears it)
   * but is no longer load-bearing for skip eligibility.
   *
   * `forceStatusRecheck` semantics: when true, bypass the cheap parse
   * entirely and fall through to full LLM extraction. This is the
   * operator override for "I don't trust DB state, re-extract from
   * scratch." Pre-#819 the same flag meant "force the cheap parse to
   * fire" — a subtle weaker guarantee since the cheap parse could
   * still skip the LLM. The new semantics match the parameter name.
   *
   * Takes `existing` as a parameter to avoid a per-bill `findUnique` —
   * callers pre-load via `loadBillSkipMetadata` at sync start.
   */
  private async tryStatusOnlyRecheck(
    statusUrl: string,
    forceStatusRecheck: boolean,
    existing: BillSkipRecord | undefined,
  ): Promise<'unchanged' | 'fall-through'> {
    if (!existing) return 'fall-through'; // brand-new bill, full extraction
    // Operator override — skip the cheap parse, force LLM re-extraction.
    if (forceStatusRecheck) return 'fall-through';

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

    // No material change. Clear the flag (idempotent on already-false) and skip.
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
