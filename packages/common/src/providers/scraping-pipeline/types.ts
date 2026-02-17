/**
 * Scraping Pipeline Types
 *
 * Types for AI-derived structural manifests that describe
 * how to extract structured data from web pages.
 *
 * The pipeline uses a "schema-on-read" pattern where AI analyzes
 * website structure to produce versioned extraction rules, rather
 * than relying on hardcoded CSS selectors.
 */

import type { DataType } from "../region/types.js";

// ============================================
// STRUCTURAL MANIFEST
// ============================================

/**
 * A structural manifest describes how to extract a specific type
 * of content from a specific URL. Derived by AI analysis.
 */
export interface StructuralManifest {
  /** Unique identifier */
  id: string;
  /** Region this manifest belongs to */
  regionId: string;
  /** The URL this manifest describes */
  sourceUrl: string;
  /** What data type this extracts */
  dataType: DataType;
  /** Version number (incremented on re-analysis) */
  version: number;
  /** SHA-256 hash of the HTML structure (stripped of content) */
  structureHash: string;
  /** SHA-256 hash of the analysis prompt that produced this manifest */
  promptHash: string;
  /** The extraction rules derived by AI */
  extractionRules: ExtractionRuleSet;
  /** Confidence score from the AI analysis (0.0-1.0) */
  confidence: number;
  /** Number of successful extractions using this manifest */
  successCount: number;
  /** Number of failed extractions using this manifest */
  failureCount: number;
  /** Whether this is the active manifest for this (regionId, sourceUrl, dataType) */
  isActive: boolean;
  /** LLM provider used for analysis */
  llmProvider?: string;
  /** LLM model used for analysis */
  llmModel?: string;
  /** Tokens consumed during analysis */
  llmTokensUsed?: number;
  /** Time spent on analysis in milliseconds */
  analysisTimeMs?: number;
  /** When this manifest was created */
  createdAt: Date;
  /** When this manifest was last successfully used */
  lastUsedAt?: Date;
  /** When the source structure was last checked */
  lastCheckedAt?: Date;
}

// ============================================
// EXTRACTION RULES
// ============================================

/**
 * A set of extraction rules for a single page/data-type combination.
 * This is the core output of AI structural analysis.
 */
export interface ExtractionRuleSet {
  /** CSS selector for the element containing all items */
  containerSelector: string;
  /** CSS selector for each individual item within the container */
  itemSelector: string;
  /** Field mappings: how to extract each field from an item */
  fieldMappings: FieldMapping[];
  /** Optional: how to handle pagination */
  pagination?: PaginationRule;
  /** Optional: preprocessing steps before extraction */
  preprocessing?: PreprocessingStep[];
  /** Free-form notes from the AI about the page structure */
  analysisNotes?: string;
}

/**
 * Mapping from a CSS selector path to a domain model field.
 */
export interface FieldMapping {
  /** The target field name (e.g., "title", "district", "scheduledAt") */
  fieldName: string;
  /** CSS selector relative to the item element */
  selector: string;
  /** What to extract from the selected element */
  extractionMethod: ExtractionMethod;
  /** For 'attribute' method: which attribute (e.g., 'href', 'src') */
  attribute?: string;
  /** For 'regex' method: the pattern to apply to the extracted text */
  regexPattern?: string;
  /** For 'regex' method: which capture group to use (default: 1) */
  regexGroup?: number;
  /** Optional transform to apply after extraction */
  transform?: FieldTransform;
  /** Whether this field is required (extraction fails if missing) */
  required: boolean;
  /** Default value if extraction yields nothing */
  defaultValue?: string;
}

export type ExtractionMethod = "text" | "attribute" | "html" | "regex";

/**
 * Post-extraction transforms for field values.
 */
export interface FieldTransform {
  type: FieldTransformType;
  /** Parameters for the transform (e.g., date format string) */
  params?: Record<string, string>;
}

export type FieldTransformType =
  | "date_parse"
  | "trim"
  | "lowercase"
  | "uppercase"
  | "strip_html"
  | "url_resolve"
  | "regex_replace"
  | "name_format";

/**
 * Rules for handling paginated content.
 */
export interface PaginationRule {
  type: "next_link" | "load_more" | "url_pattern" | "none";
  /** CSS selector for the "next page" link */
  nextSelector?: string;
  /** URL pattern with {page} placeholder */
  urlPattern?: string;
  /** Maximum pages to follow */
  maxPages: number;
}

/**
 * Preprocessing steps applied before extraction.
 */
export interface PreprocessingStep {
  type: "remove_elements" | "unwrap_elements" | "merge_tables";
  /** CSS selector for elements to process */
  selector: string;
}

// ============================================
// DECLARATIVE REGION CONFIGURATION
// ============================================

/**
 * Configuration for a single data source in a declarative plugin.
 * This is what region plugin authors provide instead of scraper code.
 */
export interface DataSourceConfig {
  /** URL to fetch data from */
  url: string;
  /** What type of content this source provides */
  dataType: DataType;
  /** Natural language description of what to find/extract */
  contentGoal: string;
  /** Optional: sub-category for grouping (e.g., "Assembly", "Senate") */
  category?: string;
  /** Optional: hints to help the AI find the right content */
  hints?: string[];
  /** Optional: override rate limit for this specific source */
  rateLimitOverride?: number;

  /** Source type determines the extraction strategy. Defaults to 'html_scrape'. */
  sourceType?: "html_scrape" | "bulk_download" | "api";

  /** Configuration for bulk_download sources (ZIP/CSV/TSV files) */
  bulk?: BulkDownloadConfig;

  /** Configuration for API sources (REST endpoints with pagination) */
  api?: ApiSourceConfig;
}

/**
 * Configuration for bulk data download sources (ZIP archives, CSV/TSV files).
 */
export interface BulkDownloadConfig {
  /** File format */
  format: "tsv" | "csv" | "zip_tsv" | "zip_csv";
  /** For ZIP archives: path/glob of target file(s) within the ZIP */
  filePattern?: string;
  /** Column delimiter override (default: tab for tsv, comma for csv) */
  delimiter?: string;
  /** Number of header lines to skip */
  headerLines?: number;
  /** Column name mappings: source column name → domain field name */
  columnMappings: Record<string, string>;
  /** Filter expressions applied during parse (e.g., { "STATE": "CA" }) */
  filters?: Record<string, string>;
}

/**
 * Configuration for REST API data sources with pagination.
 */
export interface ApiSourceConfig {
  /** HTTP method (default: GET) */
  method?: "GET" | "POST";
  /** Environment variable name containing the API key */
  apiKeyEnvVar?: string;
  /** Header name for the API key (e.g., "api_key", "Authorization") */
  apiKeyHeader?: string;
  /** Pagination strategy */
  pagination?: ApiPaginationConfig;
  /** JSON path to the items array in the response (e.g., "results" or "data.items") */
  resultsPath?: string;
  /** Static query parameters appended to every request */
  queryParams?: Record<string, string>;
}

/**
 * Pagination configuration for API sources.
 */
export interface ApiPaginationConfig {
  /** Pagination strategy type */
  type: "offset" | "cursor" | "page";
  /** Query parameter name for page/offset (e.g., "page", "offset") */
  pageParam?: string;
  /** Query parameter name for page size (e.g., "per_page", "limit") */
  limitParam?: string;
  /** Number of items per page */
  limit?: number;
}

/**
 * Full declarative region configuration.
 * Replaces procedural scraper code with a config object.
 */
export interface DeclarativeRegionConfig {
  /** Region identifier (e.g., "california") */
  regionId: string;
  /** Human-readable region name (e.g., "California") */
  regionName: string;
  /** Region description */
  description: string;
  /** IANA timezone */
  timezone: string;
  /** Two-letter US state code (e.g., "CA"). Used to scope federal data to this region. */
  stateCode?: string;
  /** Data sources to scrape */
  dataSources: DataSourceConfig[];
  /** Rate limiting defaults */
  rateLimit?: {
    requestsPerSecond: number;
    burstSize: number;
  };
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
}

// ============================================
// PIPELINE RESULTS
// ============================================

/**
 * Result of a structural analysis operation.
 */
export interface StructuralAnalysisResult {
  /** The derived manifest */
  manifest: StructuralManifest;
  /** Whether this was loaded from cache (no LLM call) */
  fromCache: boolean;
  /** Whether the structure changed since last analysis */
  structureChanged: boolean;
  /** Analysis duration in milliseconds (0 if cached) */
  analysisTimeMs: number;
}

/**
 * Result of content extraction using a manifest.
 */
export interface ExtractionResult<T> {
  /** Extracted items */
  items: T[];
  /** The manifest version used */
  manifestVersion: number;
  /** Whether extraction succeeded fully */
  success: boolean;
  /** Per-item extraction warnings (non-fatal) */
  warnings: string[];
  /** Fatal errors that prevented extraction */
  errors: string[];
  /** Extraction duration in milliseconds */
  extractionTimeMs: number;
}

/**
 * Raw extraction result before domain mapping.
 */
export interface RawExtractionResult {
  /** Raw extracted records */
  items: Record<string, unknown>[];
  /** Whether extraction succeeded */
  success: boolean;
  /** Non-fatal warnings */
  warnings: string[];
  /** Fatal errors */
  errors: string[];
}

/**
 * Pipeline execution telemetry.
 */
export interface PipelineMetrics {
  sourceUrl: string;
  dataType: DataType;
  structureAnalysisMs?: number;
  manifestCacheHit: boolean;
  structureChanged: boolean;
  extractionMs: number;
  itemsExtracted: number;
  itemsFailed: number;
  selfHealTriggered: boolean;
  llmProvider?: string;
  llmModel?: string;
  llmTokensUsed?: number;
  timestamp: Date;
}
