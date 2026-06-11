import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  resolveConfigPlaceholders,
  type DataSourceConfig,
  type DeclarativeRegionConfig,
  type ISecretsProvider,
} from '@opuspopuli/common';
import {
  RegionService as RegionProviderService,
  PluginLoaderService,
  PluginRegistryService,
  ExampleRegionProvider,
  discoverRegionConfigs,
  getRegionsDir,
  type IPipelineService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import { SECRETS_PROVIDER } from '@opuspopuli/secrets-provider';
import { ServiceInitializationException } from 'src/common/exceptions/app.exceptions';

export type RegionPluginRow = {
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
 * Owns region-plugin lifecycle, registry, and admin operations (extracted
 * from RegionSyncService as #828 Step 6).
 *
 * Responsibilities:
 *   - Boot-time plugin loading via OnModuleInit (federal + local plugins,
 *     fallback to ExampleRegionProvider when nothing is enabled)
 *   - Hot-swap of the active local plugin without service restart
 *     (refreshActiveLocalPlugin + setRegionPluginEnabled)
 *   - Plugin admin queries (listRegionPlugins, getPluginDataSourceConfigs,
 *     getRegionPluginByFipsCode, invalidateManifest)
 *   - Auto-sync of declarative region config files from `@opuspopuli/regions`
 *     into the `region_plugins` table at boot
 *   - Exposing plugin-scoped state (active RegionProviderService,
 *     pluginRegionName, normalizeExternalIdDistrict flag, bioNoisePatterns)
 *     that downstream sync services read via the public getters
 *
 * OnModuleInit ordering: this service is injected by RegionSyncService and
 * by RegionDomainService, so Nest initializes it first. By the time any
 * sync method runs, the active plugin is loaded and state is populated.
 *
 * Public surface mirrors what was previously exposed via RegionSyncService;
 * `RegionDomainService.regionSync.<method>` callers continue to work
 * because RegionSyncService keeps thin delegates that forward here.
 */
@Injectable()
export class RegionPluginService implements OnModuleInit {
  private readonly logger = new Logger(RegionPluginService.name, {
    timestamp: true,
  });
  private regionService!: RegionProviderService;
  private pluginRegionName: string | undefined;
  private pluginNormalizeDistrict = false;
  private pluginBioNoisePatterns: RegExp[] = [];

  constructor(
    private readonly pluginLoader: PluginLoaderService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly db: DbService,
    @Optional()
    @Inject('SCRAPING_PIPELINE')
    private readonly pipeline?: IPipelineService,
    @Optional()
    @Inject(SECRETS_PROVIDER)
    private readonly secretsProvider?: ISecretsProvider,
  ) {}

  /** Boot sequence: vault keys → autosync region configs → federal + local. */
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

  // ─── Public state accessors ──────────────────────────────────────────────────
  // Downstream sync services (representatives needs pluginRegionName /
  // normalizeDistrict / bioNoisePatterns; everything else needs the active
  // RegionProviderService as the default DataFetcher) read via these getters.
  // Throwing on uninitialized regionService surfaces an ordering bug rather
  // than letting downstream code see undefined.

  getRegionService(): RegionProviderService {
    if (!this.regionService) {
      throw new ServiceInitializationException(
        'RegionPluginService.regionService accessed before onModuleInit completed',
      );
    }
    return this.regionService;
  }

  getPluginRegionName(): string | undefined {
    return this.pluginRegionName;
  }

  getPluginNormalizeDistrict(): boolean {
    return this.pluginNormalizeDistrict;
  }

  getPluginBioNoisePatterns(): RegExp[] {
    return this.pluginBioNoisePatterns;
  }

  // ─── Public lifecycle / admin ────────────────────────────────────────────────

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

  // ─── Private lifecycle internals ─────────────────────────────────────────────

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
      `RegionPluginService active plugin: ${this.regionService.getProviderName()} (${info.name}), ` +
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
}
