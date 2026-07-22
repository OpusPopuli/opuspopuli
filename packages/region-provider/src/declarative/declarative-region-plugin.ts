/**
 * Declarative Region Plugin
 *
 * Bridges a DeclarativeRegionConfig to the IRegionPlugin interface.
 * Instead of custom scraper code, this plugin delegates all data fetching
 * to the ScrapingPipelineService, which uses AI-derived manifests.
 *
 * Region developers describe data sources and content goals in JSON config.
 * The pipeline handles structural analysis, extraction, and domain mapping.
 */

import { Logger } from "@nestjs/common";
import { BaseRegionPlugin } from "../base/base-plugin.js";
import type {
  ArchiveIngestOptions,
  DataType,
  RegionInfo,
  Proposition,
  Meeting,
  Representative,
  CampaignFinanceResult,
  MinutesWithActions,
  Bill,
  DeclarativeRegionConfig,
  DataSourceConfig,
  ExtractionResult,
  BoundarySourcesConfig,
} from "@opuspopuli/common";

/**
 * Interface for the pipeline service dependency.
 * Decoupled from the concrete class to avoid hard dependency on scraping-pipeline.
 */
export interface IPipelineService {
  execute<T>(
    source: DataSourceConfig,
    regionId: string,
    onBatch?: (items: T[]) => Promise<void>,
    pipelineJobId?: string,
    options?: ArchiveIngestOptions,
  ): Promise<ExtractionResult<T>>;
  invalidateManifest(regionId: string, sourceUrl: string): Promise<number>;
}

export class DeclarativeRegionPlugin extends BaseRegionPlugin {
  protected override readonly logger: Logger;
  private regionConfig: DeclarativeRegionConfig;
  private pipeline: IPipelineService;

  constructor(config: DeclarativeRegionConfig, pipeline: IPipelineService) {
    super(config.regionId);
    this.regionConfig = config;
    this.pipeline = pipeline;
    this.logger = new Logger(`DeclarativePlugin:${config.regionId}`);
  }

  getName(): string {
    return this.regionConfig.regionId;
  }

  getVersion(): string {
    return "1.0.0-declarative";
  }

  /**
   * Surface the optional boundarySources block from the region config. The
   * consumer's BoundaryLoaderService reads this to know which TIGER and
   * ArcGIS FeatureServer layers to ingest. Plugins backing regions without
   * boundary data simply have no `boundarySources` in their JSON, and we
   * return undefined per the IRegionPlugin contract. See opuspopuli#804.
   */
  getBoundarySources(): BoundarySourcesConfig | undefined {
    return this.regionConfig.boundarySources;
  }

  getRegionInfo(): RegionInfo {
    return {
      id: this.regionConfig.regionId,
      name: this.regionConfig.regionName,
      description: this.regionConfig.description,
      timezone: this.regionConfig.timezone,
      dataSourceUrls: this.regionConfig.dataSources.map((ds) => ds.url),
      stateCode: this.regionConfig.stateCode,
      fipsCode: this.regionConfig.fipsCode,
    };
  }

  getSupportedDataTypes(): DataType[] {
    const types = new Set(
      this.regionConfig.dataSources.map((ds) => ds.dataType),
    );
    return [...types];
  }

  getDataSources(dataType?: DataType): DataSourceConfig[] {
    return dataType
      ? this.regionConfig.dataSources.filter((ds) => ds.dataType === dataType)
      : this.regionConfig.dataSources;
  }

  async fetchPropositions(pipelineJobId?: string): Promise<Proposition[]> {
    return this.fetchByDataType<Proposition>(
      "propositions",
      undefined,
      undefined,
      pipelineJobId,
    );
  }

  async fetchMeetings(pipelineJobId?: string): Promise<Meeting[]> {
    // Filter out `pdf_archive` sources — those emit Minutes documents
    // and are handled by `fetchMeetingMinutes` instead. Mixing them
    // here would type-pollute the Meeting[] return.
    return this.fetchByDataType<Meeting>(
      "meetings",
      undefined,
      (s) => s.sourceType !== "pdf_archive",
      pipelineJobId,
    );
  }

  async fetchRepresentatives(): Promise<Representative[]> {
    // Multi-source dataType: scraped HTML rosters often don't carry the
    // chamber identifier explicitly (Assembly/Senate). The chamber lives
    // on the data source's `category` field — stamp it onto each rep at
    // extraction time so persistence sees `chamber` populated. Single
    // place that knows source attribution; the previous fallback in
    // RegionSyncService relied on `instanceof DeclarativeRegionPlugin`
    // which silently fails across worker bundles.
    const sources = this.regionConfig.dataSources.filter(
      (ds) => ds.dataType === "representatives",
    );
    if (sources.length === 0) {
      this.logger.warn(
        `No data sources configured for representatives in ${this.regionConfig.regionId}`,
      );
      return [];
    }

    // Per-source error isolation (#801): a single failing source must not
    // abort the whole sync. Multi-source regions like California (Senate +
    // Assembly) previously had Senate land successfully on first sync and
    // Assembly silently never recover after a transient fetch failure,
    // because any thrown error in the loop discarded `allReps` and the
    // persistence layer never ran. We now wrap each iteration in try/catch,
    // log per-source failures at WARN, and return whatever did succeed so
    // partial progress persists.
    const allReps: Representative[] = [];
    let succeededSources = 0;
    let failedSources = 0;
    for (const source of sources) {
      try {
        const { items } = await this.fetchSource<Representative>(
          source,
          "representatives",
        );
        if (source.category) {
          for (const rep of items) {
            if (!rep.chamber) rep.chamber = source.category;
          }
        }
        allReps.push(...items);
        succeededSources++;
      } catch (err) {
        failedSources++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `representatives source ${source.url} (category=${source.category ?? "none"}) failed: ${msg}. ` +
            "Continuing with remaining sources; successful items will still be persisted. See #801.",
        );
      }
    }

    const suffix =
      failedSources > 0
        ? ` (${failedSources} source(s) failed — see prior WARN)`
        : "";
    this.logger.log(
      `Fetched ${allReps.length} representatives items from ${succeededSources}/${sources.length} source(s)${suffix}`,
    );
    return allReps;
  }

  async fetchBills(): Promise<Bill[]> {
    return this.fetchByDataType<Bill>("bills");
  }

  /**
   * Fetch meeting-minutes / journal documents from `pdf_archive`
   * sources under the `meetings` dataType. The pipeline's
   * `MinutesIngestHandler` walks each source's listing page, fetches
   * per-day PDFs, and returns one MinutesWithActions per document
   * with empty actions (V1) — the backend's
   * LegislativeActionLinkerService mines the stored rawText
   * post-sync to produce action records. Issue #665.
   */
  async fetchMeetingMinutes(
    options?: ArchiveIngestOptions,
  ): Promise<MinutesWithActions[]> {
    return this.fetchByDataType<MinutesWithActions>(
      "meetings",
      undefined,
      (s) => s.sourceType === "pdf_archive",
      undefined,
      options,
    );
  }

  async fetchCampaignFinance(
    onBatch?: (items: Record<string, unknown>[]) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<CampaignFinanceResult> {
    // All campaign finance sources are fetched as a flat array,
    // then routed by the domain mapper based on category.
    const allItems = await this.fetchByDataType<Record<string, unknown>>(
      "campaign_finance",
      onBatch,
      undefined,
      pipelineJobId,
    );

    // The domain mapper already routes by category, but items come back
    // as a mixed bag. Separate them by checking known fields.
    const committees: CampaignFinanceResult["committees"] = [];
    const contributions: CampaignFinanceResult["contributions"] = [];
    const expenditures: CampaignFinanceResult["expenditures"] = [];
    const independentExpenditures: CampaignFinanceResult["independentExpenditures"] =
      [];
    const committeeMeasureFilings: CampaignFinanceResult["committeeMeasureFilings"] =
      [];

    for (const item of allItems) {
      const rec = item;
      if ("donorName" in rec && "amount" in rec) {
        contributions.push(
          rec as unknown as CampaignFinanceResult["contributions"][0],
        );
      } else if ("payeeName" in rec && "amount" in rec) {
        expenditures.push(
          rec as unknown as CampaignFinanceResult["expenditures"][0],
        );
      } else if ("supportOrOppose" in rec && "committeeName" in rec) {
        independentExpenditures.push(
          rec as unknown as CampaignFinanceResult["independentExpenditures"][0],
        );
      } else if (
        "filingId" in rec &&
        ("ballotName" in rec || "ballotNumber" in rec)
      ) {
        // CVR2 record — Form 410 ballot-measure declaration. Has filingId +
        // a ballot identifier. Discriminate before "sourceSystem + type"
        // because a CVR2 row also carries a sourceSystem.
        committeeMeasureFilings.push(
          rec as unknown as CampaignFinanceResult["committeeMeasureFilings"][0],
        );
      } else if ("sourceSystem" in rec && "type" in rec) {
        committees.push(
          rec as unknown as CampaignFinanceResult["committees"][0],
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

  override async healthCheck() {
    return {
      healthy: this.initialized,
      message: this.initialized
        ? `Declarative plugin operational — ${this.regionConfig.dataSources.length} data sources configured`
        : "Plugin not initialized",
      lastCheck: new Date(),
      metadata: {
        regionId: this.regionConfig.regionId,
        dataSourceCount: this.regionConfig.dataSources.length,
        supportedTypes: this.getSupportedDataTypes(),
      },
    };
  }

  /**
   * Fetch all data sources matching a data type and concatenate results.
   * When onBatch is provided, bulk_download sources stream batches via callback
   * instead of accumulating all items in memory.
   *
   * `sourceFilter` further narrows the matched sources by sourceType
   * (used to partition `meetings` between scheduled-meeting sources
   * and `pdf_archive` minutes sources without inventing a second
   * dataType).
   */
  private async fetchByDataType<T>(
    dataType: string,
    onBatch?: (items: T[]) => Promise<void>,
    sourceFilter?: (source: DataSourceConfig) => boolean,
    pipelineJobId?: string,
    options?: ArchiveIngestOptions,
  ): Promise<T[]> {
    const sources = this.regionConfig.dataSources.filter(
      (ds) =>
        ds.dataType === dataType && (sourceFilter ? sourceFilter(ds) : true),
    );

    if (sources.length === 0) {
      this.logger.warn(
        `No data sources configured for ${dataType} in ${this.regionConfig.regionId}`,
      );
      return [];
    }

    // Per-source error isolation (#801): mirror the pattern from
    // fetchRepresentatives. A single source failing must not discard the
    // items accumulated from previous sources. Without this, one bad bill /
    // proposition / meeting source aborts the whole batch and the persistence
    // layer never sees the successes.
    const allItems: T[] = [];
    let batchedItemCount = 0;
    let succeededSources = 0;
    let failedSources = 0;

    for (const source of sources) {
      try {
        const { items, batched } = await this.fetchSource<T>(
          source,
          dataType,
          onBatch,
          pipelineJobId,
          options,
        );
        allItems.push(...items);
        batchedItemCount += batched;
        succeededSources++;
      } catch (err) {
        failedSources++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `${dataType} source ${source.url} (category=${source.category ?? "none"}) failed: ${msg}. ` +
            "Continuing with remaining sources; successful items will still be persisted. See #801.",
        );
      }
    }

    const totalCount = allItems.length + batchedItemCount;
    const suffix =
      failedSources > 0
        ? ` (${failedSources} source(s) failed — see prior WARN)`
        : "";
    this.logger.log(
      `Fetched ${totalCount} ${dataType} items from ${succeededSources}/${sources.length} source(s)${suffix}`,
    );
    return allItems;
  }

  private async fetchSource<T>(
    source: DataSourceConfig,
    dataType: string,
    onBatch?: (items: T[]) => Promise<void>,
    pipelineJobId?: string,
    options?: ArchiveIngestOptions,
  ): Promise<{ items: T[]; batched: number }> {
    try {
      const category = source.category ? " (" + source.category + ")" : "";
      this.logger.log(`Fetching ${dataType} from ${source.url}` + category);

      const useBatch =
        onBatch &&
        (source.sourceType === "bulk_download" || source.sourceType === "api");
      const result = await this.pipeline.execute<T>(
        source,
        this.regionConfig.regionId,
        useBatch ? onBatch : undefined,
        pipelineJobId,
        options,
      );

      this.logResultDiagnostics(source.url, result);

      if (useBatch) {
        return { items: [], batched: result.itemCount ?? 0 };
      }
      return { items: result.items, batched: 0 };
    } catch (error) {
      this.logger.error(
        `Failed to fetch ${dataType} from ${source.url}: ${(error as Error).message}`,
      );
      return { items: [], batched: 0 };
    }
  }

  private logResultDiagnostics<T>(
    url: string,
    result: ExtractionResult<T>,
  ): void {
    if (result.warnings.length > 0) {
      this.logger.warn(`Warnings from ${url}: ${result.warnings.join(", ")}`);
    }
    if (result.errors.length > 0) {
      this.logger.error(`Errors from ${url}: ${result.errors.join(", ")}`);
    }
  }
}
