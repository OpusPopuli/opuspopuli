/**
 * Scraping Pipeline
 *
 * AI-powered schema-on-read scraping pipeline for Opus Populi.
 *
 * Instead of hardcoded CSS selectors, this pipeline uses AI to analyze
 * website structure and derive extraction rules as versioned manifests.
 * Content extraction is then deterministic and cheap (Cheerio-based),
 * while structural analysis is expensive but cached.
 */

// Core pipeline
export { ScrapingPipelineService } from "./pipeline/pipeline.service.js";
export { ScrapingPipelineModule } from "./scraping-pipeline.module.js";

// Analysis
export { StructuralAnalyzerService } from "./analysis/structural-analyzer.service.js";
export {
  extractHtmlSkeleton,
  computeStructureHash,
} from "./analysis/structure-hasher.js";
export { PromptClientService } from "./analysis/prompt-client.service.js";

// Manifest management
export { ManifestStoreService } from "./manifest/manifest-store.service.js";
export { ManifestComparator } from "./manifest/manifest-comparator.js";

// Extraction
export { ManifestExtractorService } from "./extraction/manifest-extractor.service.js";
export { FieldTransformer } from "./extraction/field-transformer.js";
export { ExtractionValidator } from "./extraction/extraction-validator.js";

// Domain mapping
export { DomainMapperService } from "./mapping/domain-mapper.service.js";

// Self-healing
export { SelfHealingService } from "./healing/self-healing.service.js";

// Source type handlers
export { BulkDownloadHandler } from "./handlers/bulk-download.handler.js";
export { ApiIngestHandler } from "./handlers/api-ingest.handler.js";

// Validation
export { ConfigValidator } from "./validation/config-validator.js";

// Re-export pipeline types from common
export type {
  StructuralManifest,
  ExtractionRuleSet,
  FieldMapping,
  FieldTransform,
  FieldTransformType,
  ExtractionMethod,
  PaginationRule,
  PreprocessingStep,
  DataSourceConfig,
  DeclarativeRegionConfig,
  StructuralAnalysisResult,
  ExtractionResult,
  RawExtractionResult,
  PipelineMetrics,
  PromptServiceResponse,
} from "@opuspopuli/common";
