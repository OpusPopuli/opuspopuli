import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  resolveConfigPlaceholders,
  resolveHostRatePolicies,
  type DataSourceConfig,
  type DeclarativeRegionConfig,
  type IHostRateLimiter,
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
import { toRegionPluginRow, type RegionPluginRow } from './region.service';
import { DEFAULT_HOST_RATE, HOST_RATE_LIMITER } from './region.tokens';

export type { RegionPluginRow };

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
 * What the loaded local plugins were built from. Rows arrive sorted
 * (`comparePluginRows`) and `config` is jsonb, whose key order Postgres
 * normalises, so equal rows always hash equal.
 */
function fingerprint(
  rows: { name: string; config: unknown; parentRegionId: string | null }[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(rows.map((r) => [r.name, r.parentRegionId, r.config])),
    )
    .digest('hex');
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
/** How often host rate policies are republished; see scheduleRepublish. */
const HOST_RATE_REPUBLISH_MS = 60 * 60 * 1000;

@Injectable()
export class RegionPluginService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegionPluginService.name, {
    timestamp: true,
  });
  private republishTimer?: NodeJS.Timeout;
  private regionService!: RegionProviderService;
  private pluginRegionName: string | undefined;
  private pluginNormalizeDistrict = false;
  private pluginBioNoisePatterns: RegExp[] = [];
  private pluginBioTrimPatterns: RegExp[] = [];
  /** `fingerprint` of the rows the registry was last built from. */
  private loadedFingerprint?: string;

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
    /**
     * Where the per-host fetch policies go (S1). Optional: without it the
     * region configs' `rateLimit` simply is not published, which is how
     * every sync ran before S1.
     */
    @Optional()
    @Inject(HOST_RATE_LIMITER)
    private readonly hostRateLimiter?: IHostRateLimiter,
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

  /** Patterns trimmed OUT of a scraped bio, as opposed to rejecting it. */
  getPluginBioTrimPatterns(): RegExp[] {
    return this.pluginBioTrimPatterns;
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
  /**
   * @param force - Rebuild even when the rows are unchanged: the recovery
   *   mutation and admin toggles, which ask for exactly that.
   */
  async refreshActiveLocalPlugin(force = false): Promise<void> {
    const { localConfigRow, allLocalConfigRows } =
      await this.fetchLocalPluginConfigs();
    // Every sync calls this (S2): rebuild only when the enabled plugin rows
    // actually changed — an admin toggle — not on every job.
    if (
      !force &&
      this.loadedFingerprint === fingerprint(allLocalConfigRows) &&
      this.pluginRegistry.hasActive()
    ) {
      return;
    }
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
    cascade = false,
  ): Promise<RegionPluginRow> {
    const select = {
      name: true,
      displayName: true,
      description: true,
      version: true,
      enabled: true,
      parentRegionId: true,
      fipsCode: true,
    } as const;

    // Optional cascade-down: also toggle every descendant. A child's
    // `parentRegionId` equals its parent's `name`, so a single `updateMany`
    // covers the current one-level (state → county) hierarchy. `federal` is
    // excluded for symmetry with fetchLocalPluginConfigs — it never has a
    // state parent. The primary update and the cascade run in ONE
    // transaction so a partial failure can't leave the subtree half-toggled
    // (the exact "partially-enabled state" risk #886 exists to remove).
    let row: Prisma.RegionPluginGetPayload<{ select: typeof select }>;
    let cascadedCount = 0;
    if (cascade) {
      const [updated, cascadeResult] = await this.db.$transaction([
        this.db.regionPlugin.update({
          where: { name },
          data: { enabled },
          select,
        }),
        this.db.regionPlugin.updateMany({
          where: { parentRegionId: name, name: { not: 'federal' } },
          data: { enabled },
        }),
      ]);
      row = updated;
      cascadedCount = cascadeResult.count;
    } else {
      // Default path: a single atomic row update — unchanged behavior.
      row = await this.db.regionPlugin.update({
        where: { name },
        data: { enabled },
        select,
      });
    }

    this.logger.log(
      `Region plugin "${name}" ${enabled ? 'enabled' : 'disabled'}`,
    );
    if (cascade) {
      this.logger.log(
        `Cascade ${enabled ? 'enabled' : 'disabled'} ${cascadedCount} ` +
          `descendant plugin(s) of "${name}"`,
      );
    }
    // Hot-swap the active plugin so the change takes effect immediately —
    // without this, the in-memory registry stays on whatever it loaded at
    // boot and `regionInfo` keeps returning the stale active region. See
    // #796 for the failure mode this fixes. Runs after the (committed)
    // cascade so the refresh sees the newly-toggled children.
    // An admin toggle asks for a rebuild — forced, whatever the rows compare.
    await this.refreshActiveLocalPlugin(true);
    return { ...toRegionPluginRow(row), cascadedCount };
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
    // Build-then-swap (S2): the new plugins are initialised before the old
    // ones leave the registry, so a sync running beside this one never sees
    // an empty registry. The old unregister-then-reinit emptied it across
    // every await in between, and `syncAll` calls this at the start of every
    // job. A running sync's instance IS still destroyed after the swap —
    // harmless only while `destroy()` is a flag reset, as it is for every
    // declarative plugin today.
    await this.initLocalPlugins(allLocalConfigRows);

    const localPlugin = this.pluginRegistry.getLocal();
    if (!localPlugin) {
      throw new ServiceInitializationException(
        'No local region plugin available after initialization',
      );
    }

    // Remembered only when every row loaded: a plugin that failed, or the
    // fallback standing in for none, is retried on the next sync, as it was
    // when every sync rebuilt.
    const allLoaded =
      allLocalConfigRows.length > 0 &&
      allLocalConfigRows.every((row) => this.pluginRegistry.getLocal(row.name));
    this.loadedFingerprint = allLoaded
      ? fingerprint(allLocalConfigRows)
      : undefined;
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
    this.pluginBioTrimPatterns = (pluginCfg?.bioTrimPatterns ?? []).map(
      (p) => new RegExp(p, 'i'),
    );
    this.logger.log(
      `RegionPluginService active plugin: ${this.regionService.getProviderName()} (${info.name}), ` +
        `federal: ${this.pluginRegistry.getFederal() ? 'loaded' : 'not loaded'}`,
    );
    await this.publishHostRatePolicies();
  }

  /**
   * Republish the host policies hourly, from first publish on.
   *
   * Publication otherwise happens only when plugins load, and a node runs for
   * weeks between loads. A publish that failed at boot (Redis briefly down),
   * or policies lost with Redis's data, would leave the FEC host on the
   * default until the next deploy. Unref'd so it never holds a process open.
   */
  private scheduleRepublish(): void {
    if (this.republishTimer) return;
    this.republishTimer = setInterval(() => {
      this.publishHostRatePolicies().catch((error: Error) =>
        this.logger.warn(`Host rate policy republish failed: ${error.message}`),
      );
    }, HOST_RATE_REPUBLISH_MS);
    this.republishTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.republishTimer) clearInterval(this.republishTimer);
    this.republishTimer = undefined;
  }

  /**
   * Turn every loaded region's declared fetch rates into per-host policies
   * and publish them (S1, `docs/plans/S1-per-host-rate-limiter.md`).
   *
   * Every load path ends here — boot, the admin toggle, the recovery
   * mutation — after the federal plugin is up, so the published set always
   * covers both. Region configs declared a `rateLimit` long before anything
   * applied it; federal's 0.25 rps is the FEC API's quota.
   */
  private async publishHostRatePolicies(): Promise<void> {
    if (!this.hostRateLimiter) {
      // Optional only so test modules need not bind one. Unbound in an app,
      // no region's declared rate is published and every host — the FEC API
      // included — runs at the default: say so, once per load.
      this.logger.warn(
        'No HOST_RATE_LIMITER bound: region rate limits are not published, ' +
          'and every host runs at the default rate',
      );
      return;
    }
    this.scheduleRepublish();
    const regions = this.pluginRegistry.getAll().map(({ instance }) => ({
      rateLimit: instance.getRateLimit?.(),
      dataSources: instance.getDataSources?.() ?? [],
    }));
    const policies = resolveHostRatePolicies(
      regions,
      DEFAULT_HOST_RATE,
      (rejected) =>
        this.logger.warn(
          `Ignoring invalid ${rejected.field} ${JSON.stringify(rejected.value)} ` +
            `for ${rejected.host}; it must be a positive number`,
        ),
    );
    await this.hostRateLimiter.setPolicies(policies);
    this.logger.log(
      `Host rate policies published for ${policies.size} host(s): ` +
        [...policies]
          .map(
            ([host, p]) => `${host}=${p.requestsPerSecond}rps/${p.burstSize}`,
          )
          .join(', '),
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
    }

    const built = rows.flatMap((row) => {
      const config = row.config as Record<string, unknown> | undefined;
      try {
        this.logger.log(
          `Loading local declarative region plugin "${row.name}"`,
        );
        const instance = this.pluginLoader.buildPlugin(
          { name: row.name, config },
          this.pipeline,
        );
        return [{ name: row.name, instance, config }];
      } catch (error) {
        this.logger.error(
          `Failed to load plugin "${row.name}": ${(error as Error).message}`,
        );
        return [];
      }
    });

    // One atomic replacement, fallback included, so no reader ever sees an
    // empty local slot (see `reloadActiveLocalPlugin`).
    await this.pluginRegistry.replaceLocal(built, () => ({
      name: 'example',
      instance: this.createFallbackPlugin(),
    }));
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
