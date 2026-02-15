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
import {
  BaseRegionPlugin,
  type DataType,
  type RegionInfo,
  type Proposition,
  type Meeting,
  type Representative,
} from "@opuspopuli/region-plugin-sdk";
import type {
  DeclarativeRegionConfig,
  DataSourceConfig,
  ExtractionResult,
} from "@opuspopuli/common";

/**
 * Interface for the pipeline service dependency.
 * Decoupled from the concrete class to avoid hard dependency on scraping-pipeline.
 */
export interface IPipelineService {
  execute<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>>;
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

  getRegionInfo(): RegionInfo {
    return {
      id: this.regionConfig.regionId,
      name: this.regionConfig.regionName,
      description: this.regionConfig.description,
      timezone: this.regionConfig.timezone,
      dataSourceUrls: this.regionConfig.dataSources.map((ds) => ds.url),
    };
  }

  getSupportedDataTypes(): DataType[] {
    const types = new Set(
      this.regionConfig.dataSources.map((ds) => ds.dataType),
    );
    return [...types];
  }

  async fetchPropositions(): Promise<Proposition[]> {
    return this.fetchByDataType<Proposition>("propositions");
  }

  async fetchMeetings(): Promise<Meeting[]> {
    return this.fetchByDataType<Meeting>("meetings");
  }

  async fetchRepresentatives(): Promise<Representative[]> {
    return this.fetchByDataType<Representative>("representatives");
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
   */
  private async fetchByDataType<T>(dataType: string): Promise<T[]> {
    const sources = this.regionConfig.dataSources.filter(
      (ds) => ds.dataType === dataType,
    );

    if (sources.length === 0) {
      this.logger.warn(
        `No data sources configured for ${dataType} in ${this.regionConfig.regionId}`,
      );
      return [];
    }

    const allItems: T[] = [];
    const errors: string[] = [];

    for (const source of sources) {
      try {
        this.logger.log(
          `Fetching ${dataType} from ${source.url}${source.category ? ` (${source.category})` : ""}`,
        );
        const result = await this.pipeline.execute<T>(
          source,
          this.regionConfig.regionId,
        );

        allItems.push(...result.items);

        if (result.warnings.length > 0) {
          this.logger.warn(
            `Warnings from ${source.url}: ${result.warnings.join(", ")}`,
          );
        }
        if (result.errors.length > 0) {
          errors.push(...result.errors);
          this.logger.error(
            `Errors from ${source.url}: ${result.errors.join(", ")}`,
          );
        }
      } catch (error) {
        const message = `Failed to fetch ${dataType} from ${source.url}: ${(error as Error).message}`;
        this.logger.error(message);
        errors.push(message);
        // Continue with remaining sources — partial results are acceptable
      }
    }

    this.logger.log(
      `Fetched ${allItems.length} ${dataType} items from ${sources.length} source(s)`,
    );
    return allItems;
  }
}
