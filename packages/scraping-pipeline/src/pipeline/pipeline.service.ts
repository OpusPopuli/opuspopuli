/**
 * Scraping Pipeline Service
 *
 * Orchestrates the 4-stage pipeline:
 * 1. Structural Analysis (AI, cached) → manifest
 * 2. Manifest Comparison (hash check) → reuse or re-derive
 * 3. Content Extraction (Cheerio, deterministic) → raw records
 * 4. Domain Mapping (Zod validation) → typed domain objects
 *
 * Plus self-healing: if extraction fails, re-trigger analysis once.
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  DataSourceConfig,
  ExtractionResult,
  StructuralAnalysisResult,
  DataType,
} from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { StructuralAnalyzerService } from "../analysis/structural-analyzer.service.js";
import { computeStructureHash } from "../analysis/structure-hasher.js";
import { ManifestStoreService } from "../manifest/manifest-store.service.js";
import { ManifestComparator } from "../manifest/manifest-comparator.js";
import { ManifestExtractorService } from "../extraction/manifest-extractor.service.js";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";
import { SelfHealingService } from "../healing/self-healing.service.js";
import { BulkDownloadHandler } from "../handlers/bulk-download.handler.js";
import { ApiIngestHandler } from "../handlers/api-ingest.handler.js";

@Injectable()
export class ScrapingPipelineService {
  private readonly logger = new Logger(ScrapingPipelineService.name);

  constructor(
    private readonly extraction: ExtractionProvider,
    private readonly analyzer: StructuralAnalyzerService,
    private readonly manifestStore: ManifestStoreService,
    private readonly extractor: ManifestExtractorService,
    private readonly mapper: DomainMapperService,
    private readonly healing: SelfHealingService,
    private readonly bulkDownload: BulkDownloadHandler,
    private readonly apiIngest: ApiIngestHandler,
  ) {}

  /**
   * Execute the pipeline for a data source.
   * Routes to the appropriate handler based on sourceType.
   *
   * @param source - Data source configuration
   * @param regionId - The region this source belongs to
   * @returns Typed extraction result with items and diagnostics
   */
  async execute<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>> {
    const sourceType = source.sourceType ?? "html_scrape";

    switch (sourceType) {
      case "bulk_download":
        return this.executeBulkDownload<T>(source, regionId);
      case "api":
        return this.executeApiIngest<T>(source, regionId);
      case "html_scrape":
      default:
        return this.executeHtmlScrape<T>(source, regionId);
    }
  }

  /**
   * Execute the HTML scraping pipeline (original behavior).
   * AI structural analysis → Cheerio extraction → domain mapping.
   */
  private async executeHtmlScrape<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    this.logger.log(
      `Pipeline started [html_scrape]: ${regionId}/${source.dataType} from ${source.url}`,
    );

    // Fetch HTML
    const fetchResult = await this.extraction.fetchWithRetry(source.url);
    const html = fetchResult.content;

    // Stage 1+2: Get or derive manifest
    const analysisResult = await this.getOrDeriveManifest(
      source,
      regionId,
      html,
    );
    const manifest = analysisResult.manifest;

    // Stage 3: Extract content using manifest
    let rawResult = this.extractor.extract(html, manifest, source.url);

    // Self-healing: check if extraction results are acceptable
    const healingDecision = this.healing.evaluate(rawResult, manifest);

    if (healingDecision.shouldHeal) {
      this.logger.warn(
        `Self-healing: re-analyzing ${source.url} — ${healingDecision.reason}`,
      );

      // Re-derive manifest
      const newManifest = await this.analyzer.analyze(html, source);
      newManifest.regionId = regionId;
      newManifest.version = manifest.version + 1;
      await this.manifestStore.save(newManifest);

      // Re-extract with new manifest
      rawResult = this.extractor.extract(html, newManifest, source.url);

      // Check again (but don't heal again)
      const secondCheck = this.healing.evaluate(
        rawResult,
        newManifest,
        undefined,
        true,
      );
      if (secondCheck.shouldHeal) {
        await this.manifestStore.incrementFailure(newManifest.id);
      } else {
        // New manifest worked — record success
        await this.manifestStore.incrementSuccess(newManifest.id);
      }
    } else {
      // Original manifest worked — record success and update timestamps
      await this.manifestStore.incrementSuccess(manifest.id);
      await this.manifestStore.markChecked(manifest.id);
    }

    // Stage 4: Map to domain types
    const result = this.mapper.map<T>(rawResult, source);
    result.manifestVersion = manifest.version;

    const totalMs = Date.now() - pipelineStart;
    this.logger.log(
      `Pipeline complete: ${result.items.length} items extracted in ${totalMs}ms ` +
        `(cache: ${analysisResult.fromCache}, heal: ${healingDecision.shouldHeal})`,
    );

    return result;
  }

  /**
   * Get an existing manifest or derive a new one via AI analysis.
   */
  private async getOrDeriveManifest(
    source: DataSourceConfig,
    regionId: string,
    html: string,
  ): Promise<StructuralAnalysisResult> {
    // Compute current structure hash
    const currentStructureHash = computeStructureHash(html);

    // Compute current prompt hash
    const currentPromptHash = await this.analyzer.getCurrentPromptHash(
      source.dataType as DataType,
    );

    // Look up existing manifest
    const existing = await this.manifestStore.findLatest(
      regionId,
      source.url,
      source.dataType as DataType,
    );

    // Compare hashes
    const comparison = ManifestComparator.compare(
      existing,
      currentStructureHash,
      currentPromptHash,
    );

    if (comparison.canReuse && existing) {
      this.logger.debug(
        `Manifest cache hit for ${source.url} (v${existing.version})`,
      );
      return {
        manifest: existing,
        fromCache: true,
        structureChanged: false,
        analysisTimeMs: 0,
      };
    }

    // Need fresh analysis
    if (comparison.reason) {
      this.logger.log(
        `Manifest cache miss for ${source.url}: ${comparison.reason}`,
      );
    }

    const startTime = Date.now();
    const manifest = await this.analyzer.analyze(html, source);
    const analysisTimeMs = Date.now() - startTime;

    // Set region and version
    manifest.regionId = regionId;
    manifest.version = existing ? existing.version + 1 : 1;
    manifest.structureHash = currentStructureHash;

    // Persist
    await this.manifestStore.save(manifest);

    return {
      manifest,
      fromCache: false,
      structureChanged: comparison.structureChanged,
      analysisTimeMs,
    };
  }

  /**
   * Execute bulk download pipeline.
   * Delegates to BulkDownloadHandler for ZIP/CSV/TSV parsing.
   */
  private async executeBulkDownload<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>> {
    this.logger.log(
      `Pipeline started [bulk_download]: ${regionId}/${source.dataType} from ${source.url}`,
    );

    if (!source.bulk) {
      return {
        items: [],
        manifestVersion: 0,
        success: false,
        warnings: [],
        errors: ["bulk_download source missing 'bulk' configuration"],
        extractionTimeMs: 0,
      };
    }

    return this.bulkDownload.execute<T>(source, regionId);
  }

  /**
   * Execute API ingestion pipeline.
   * Delegates to ApiIngestHandler for paginated REST API requests.
   */
  private async executeApiIngest<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>> {
    this.logger.log(
      `Pipeline started [api]: ${regionId}/${source.dataType} from ${source.url}`,
    );

    if (!source.api) {
      return {
        items: [],
        manifestVersion: 0,
        success: false,
        warnings: [],
        errors: ["api source missing 'api' configuration"],
        extractionTimeMs: 0,
      };
    }

    return this.apiIngest.execute<T>(source, regionId);
  }
}
