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

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type {
  DataSourceConfig,
  ExtractionResult,
  ILLMProvider,
  RawExtractionResult,
  StructuralAnalysisResult,
  StructuralManifest,
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
import { PdfExtractHandler } from "../handlers/pdf-extract.handler.js";
import { MinutesIngestHandler } from "../handlers/minutes-ingest.handler.js";
import { DetailCrawlerService } from "../crawling/detail-crawler.service.js";
import {
  MANIFEST_MISSING_CALLBACK,
  type ManifestMissingArgs,
} from "../scraping-pipeline.module.js";

@Injectable()
export class ScrapingPipelineService {
  private readonly logger = new Logger(ScrapingPipelineService.name);

  constructor(
    @Inject("LLM_PROVIDER") private readonly llm: ILLMProvider,
    private readonly extraction: ExtractionProvider,
    private readonly analyzer: StructuralAnalyzerService,
    private readonly manifestStore: ManifestStoreService,
    private readonly extractor: ManifestExtractorService,
    private readonly mapper: DomainMapperService,
    private readonly healing: SelfHealingService,
    private readonly bulkDownload: BulkDownloadHandler,
    private readonly apiIngest: ApiIngestHandler,
    private readonly pdfExtract: PdfExtractHandler,
    private readonly minutesIngest: MinutesIngestHandler,
    private readonly detailCrawler: DetailCrawlerService,
    @Optional()
    @Inject(MANIFEST_MISSING_CALLBACK)
    private readonly onManifestMissing:
      | ((args: ManifestMissingArgs) => Promise<void>)
      | null,
  ) {}

  /**
   * Fetch HTML, run structural analysis, persist the manifest, and return its ID.
   * Called by the structural-analysis-worker on cache miss / stale-refresh.
   */
  async performManifestAnalysis(
    regionId: string,
    sourceUrl: string,
    dataType: string,
    contentGoal = "",
    category?: string,
    hints?: string[],
  ): Promise<{ manifestId: string; manifestVersion: number }> {
    const fetchResult = await this.extraction.fetchWithRetry(sourceUrl);
    const html = fetchResult.content;

    const source = {
      url: sourceUrl,
      dataType: dataType as DataType,
      contentGoal,
      category,
      hints,
      sourceType: "html_scrape" as const,
    };

    const manifest = await this.analyzer.analyze(html, source);
    manifest.regionId = regionId;
    manifest.version = await this.manifestStore.getNextVersion(
      regionId,
      sourceUrl,
      dataType as DataType,
    );
    manifest.structureHash = computeStructureHash(html);
    await this.manifestStore.save(manifest);

    return { manifestId: manifest.id, manifestVersion: manifest.version };
  }

  /**
   * Execute the pipeline for a data source.
   * Routes to the appropriate handler based on sourceType.
   *
   * @param source - Data source configuration
   * @param regionId - The region this source belongs to
   * @returns Typed extraction result with items and diagnostics
   */
  async invalidateManifest(
    regionId: string,
    sourceUrl: string,
  ): Promise<number> {
    return this.manifestStore.invalidate(regionId, sourceUrl);
  }

  async execute<T>(
    source: DataSourceConfig,
    regionId: string,
    onBatch?: (items: T[]) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<ExtractionResult<T>> {
    const sourceType = source.sourceType ?? "html_scrape";

    switch (sourceType) {
      case "bulk_download":
        return this.executeBulkDownload<T>(
          source,
          regionId,
          onBatch,
          pipelineJobId,
        );
      case "api":
        return this.executeApiIngest<T>(source, regionId, pipelineJobId);
      case "pdf":
        return this.executePdfExtract<T>(source, regionId);
      case "pdf_archive":
        return this.executePdfArchive<T>(source, regionId);
      case "html_scrape":
      default:
        return this.executeHtmlScrape<T>(source, regionId);
    }
  }

  /**
   * Execute pdf_archive ingestion: listing-walk → per-PDF fetch +
   * pdf-parse → emit one MinutesWithActions per document. The
   * downstream backend linker mines stored rawText to produce
   * LegislativeAction rows post-sync.
   */
  private async executePdfArchive<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>> {
    return this.minutesIngest.execute(source, regionId) as unknown as Promise<
      ExtractionResult<T>
    >;
  }

  /**
   * Execute extraction using caller-supplied selectors, bypassing AI analysis.
   * No LLM call, no manifest store, no self-heal loop.
   */
  private executeStaticManifest<T>(
    source: DataSourceConfig,
    regionId: string,
    html: string,
    pipelineStart: number,
  ): ExtractionResult<T> {
    const sm = source.staticManifest!;
    const syntheticManifest = {
      id: `static-${regionId}-${source.dataType}`,
      regionId,
      sourceUrl: source.url,
      dataType: source.dataType,
      version: 0,
      structureHash: "static",
      promptHash: "static",
      extractionRules: {
        containerSelector: sm.containerSelector,
        itemSelector: sm.itemSelector,
        fieldMappings: sm.fieldMappings,
      },
      isActive: true,
      successCount: 0,
      failureCount: 0,
      createdAt: new Date(),
      lastCheckedAt: new Date(),
    };

    const rawResult = this.extractor.extract(
      html,
      syntheticManifest as never,
      source.url,
    );
    const duration = Date.now() - pipelineStart;
    this.logger.log(
      `Pipeline complete [static]: ${rawResult.items.length} items extracted in ${duration}ms`,
    );
    return rawResult as unknown as ExtractionResult<T>;
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
    // When a staticManifest is provided in the source config, bypass AI analysis
    // entirely — no LLM call, no manifest persistence, no self-heal loop.
    if (source.staticManifest) {
      return this.executeStaticManifest<T>(
        source,
        regionId,
        html,
        pipelineStart,
      );
    }

    const analysisResult = await this.getOrDeriveManifest(
      source,
      regionId,
      html,
    );

    // Cold manifest miss with async worker configured — skip extraction this run.
    if (analysisResult === null) {
      const totalMs = Date.now() - pipelineStart;
      this.logger.log(
        `Pipeline deferred [${regionId}/${source.dataType}] — manifest analysis enqueued (${totalMs}ms)`,
      );
      return {
        items: [] as T[],
        manifestVersion: 0,
        success: true,
        warnings: [],
        errors: [],
        extractionTimeMs: 0,
        pendingManifestAnalysis: true,
      };
    }

    const manifest = analysisResult.manifest;

    // Stage 3: Extract content using manifest
    let rawResult = this.extractor.extract(html, manifest, source.url);
    let effectiveVersion = manifest.version;

    // Self-healing: check if extraction results are acceptable. Passing the
    // stored lastItemCount lets the validator flag a sharp *drop* (e.g. 13 → 1),
    // not just a total zero (#911).
    const healingDecision = this.healing.evaluate(
      rawResult,
      manifest,
      manifest.lastItemCount,
    );

    if (healingDecision.shouldHeal) {
      // Stale cached rules produced degraded output. Re-derive and re-extract
      // in THIS run — even in async/worker mode — so the sync self-heals
      // immediately instead of silently returning the degraded set and
      // deferring to a background refresh that may not converge (#911).
      this.logger.warn(
        `Self-healing: re-analyzing ${source.url} — ${healingDecision.reason}`,
      );
      const healed = await this.healManifest(source, regionId, html, manifest);
      rawResult = healed.rawResult;
      effectiveVersion = healed.version;
    } else {
      // Original manifest worked — record success (updating the drift baseline)
      // and refresh the checked timestamp.
      await this.manifestStore.incrementSuccess(
        manifest.id,
        rawResult.items.length,
      );
      await this.manifestStore.markChecked(manifest.id);
    }

    // Stage 3.5: Enrich items with detail page content (if detailUrl extracted)
    // Also check contactInfo.website — AI sometimes maps homepage links there instead of detailUrl
    for (const item of rawResult.items) {
      if (!item.detailUrl) {
        item.detailUrl =
          item["contactInfo.website"] ??
          (item.contactInfo as Record<string, unknown> | undefined)?.website;
      }
    }
    if (rawResult.items.some((item) => item.detailUrl)) {
      rawResult = await this.detailCrawler.enrichItems(
        rawResult,
        source,
        this.llm,
      );
    }

    // Stage 4: Map to domain types
    const result = this.mapper.map<T>(rawResult, source);
    result.manifestVersion = effectiveVersion;

    const totalMs = Date.now() - pipelineStart;
    this.logger.log(
      `Pipeline complete: ${result.items.length} items extracted in ${totalMs}ms ` +
        `(cache: ${analysisResult.fromCache}, heal: ${healingDecision.shouldHeal})`,
    );

    return result;
  }

  /**
   * Re-derive a manifest for a source whose cached rules produced degraded
   * output, then re-extract with the fresh manifest. Bounded to a single
   * re-analysis per run (healAttempted=true) so a genuinely-empty or
   * genuinely-shrunken source can't loop. Records the new drift baseline on
   * success. Returns the re-extracted result and the new manifest version.
   * See #911.
   */
  private async healManifest(
    source: DataSourceConfig,
    regionId: string,
    html: string,
    staleManifest: StructuralManifest,
  ): Promise<{ rawResult: RawExtractionResult; version: number }> {
    await this.manifestStore.incrementFailure(staleManifest.id);

    const newManifest = await this.analyzer.analyze(html, source);
    newManifest.regionId = regionId;
    newManifest.version = await this.manifestStore.getNextVersion(
      regionId,
      source.url,
      source.dataType,
    );
    newManifest.structureHash = computeStructureHash(html);
    const saved = await this.manifestStore.save(newManifest);

    const rawResult = this.extractor.extract(html, saved, source.url);
    const secondCheck = this.healing.evaluate(
      rawResult,
      saved,
      undefined,
      true,
    );
    if (secondCheck.shouldHeal) {
      await this.manifestStore.incrementFailure(saved.id);
      this.logger.warn(
        `Self-heal re-extraction still degraded for ${source.url}: ` +
          `${rawResult.items.length} item(s)`,
      );
    } else {
      await this.manifestStore.incrementSuccess(
        saved.id,
        rawResult.items.length,
      );
    }

    return { rawResult, version: saved.version };
  }

  /**
   * Get an existing manifest or derive a new one via AI analysis.
   *
   * When onManifestMissing is wired:
   * - Cache miss  → callback fired, returns null (caller skips extraction this run)
   * - Cache stale → callback fired for background refresh, returns existing manifest
   *                 so extraction still runs with the old rules this run
   *
   * When onManifestMissing is null (default / local dev) the original inline
   * behaviour is preserved — LLM analysis runs synchronously.
   */
  private async getOrDeriveManifest(
    source: DataSourceConfig,
    regionId: string,
    html: string,
  ): Promise<StructuralAnalysisResult | null> {
    const currentStructureHash = computeStructureHash(html);
    const currentPromptHash = await this.analyzer.getCurrentPromptHash(
      source.dataType as DataType,
    );

    const existing = await this.manifestStore.findLatest(
      regionId,
      source.url,
      source.dataType as DataType,
    );

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

    const missReason = comparison.reason ?? "unknown";
    const isStale = !!existing && !comparison.canReuse;

    if (this.onManifestMissing) {
      // Async path: delegate analysis to the structural-analysis worker.
      const requestedBy = isStale ? "cache_stale" : "cache_miss";
      this.logger.log(
        `Manifest ${requestedBy} for ${source.url}: ${missReason} — enqueuing analysis`,
      );
      await this.onManifestMissing({
        regionId,
        sourceUrl: source.url,
        dataType: source.dataType,
        contentGoal: source.contentGoal,
        category: source.category,
        hints: source.hints,
        requestedBy,
      });

      if (isStale) {
        // Extract with old manifest this run; worker refreshes in background.
        return {
          manifest: existing!,
          fromCache: true,
          structureChanged: true,
          analysisTimeMs: 0,
        };
      }

      // Cold miss — no manifest at all. Signal caller to skip extraction.
      return null;
    }

    // Inline path (fallback when no callback configured).
    this.logger.log(`Manifest cache miss for ${source.url}: ${missReason}`);
    const startTime = Date.now();
    const manifest = await this.analyzer.analyze(html, source);
    const analysisTimeMs = Date.now() - startTime;

    manifest.regionId = regionId;
    manifest.version = await this.manifestStore.getNextVersion(
      regionId,
      source.url,
      source.dataType,
    );
    manifest.structureHash = currentStructureHash;
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
    onBatch?: (items: T[]) => Promise<void>,
    pipelineJobId?: string,
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

    return this.bulkDownload.execute<T>(
      source,
      regionId,
      onBatch,
      pipelineJobId,
    );
  }

  /**
   * Execute API ingestion pipeline.
   * Delegates to ApiIngestHandler for paginated REST API requests.
   */
  private async executeApiIngest<T>(
    source: DataSourceConfig,
    regionId: string,
    pipelineJobId?: string,
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

    return this.apiIngest.execute<T>(
      source,
      regionId,
      undefined,
      pipelineJobId,
    );
  }

  /**
   * Execute PDF extraction pipeline.
   * Downloads PDF, extracts text, uses AI to produce text extraction rules,
   * then extracts structured data using regex/line-based patterns.
   */
  private async executePdfExtract<T>(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<T>> {
    this.logger.log(
      `Pipeline started [pdf]: ${regionId}/${source.dataType} from ${source.url}`,
    );

    // Provide LLM and PDF text extraction as callbacks. Use the
    // binary-safe fetchPdfText path — the old `fetchWithRetry +
    // Buffer.from(content, "binary")` pattern silently mangled real
    // PDF bytes via response.text()'s UTF-8 decode, leaving PDFParse
    // to fail with "Invalid Root reference".
    return this.pdfExtract.execute<T>(
      source,
      regionId,
      this.llm,
      (url: string) => this.extraction.fetchPdfText(url),
    );
  }
}
