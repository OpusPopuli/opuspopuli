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
  /** Search scope: 'item' (default) searches within the item element,
   *  'container' searches from the container element (for sibling data like headings) */
  scope?: "item" | "container";
  /** For 'structured' method: per-child extraction config. Each value is
   *  either a string selector (legacy DSL with `_text` / `_regex:` / `|attr:`
   *  shortcuts) or a full ChildFieldConfig object that supports
   *  extractionMethod + transform. Produces an array of objects. */
  children?: Record<string, ChildFieldConfig>;
}

/**
 * Per-child extraction config inside a `structured` FieldMapping.
 *
 * Two equivalent forms:
 *
 * 1. **String shortcut** — terse DSL parsed by the structured extractor:
 *    - `"css-selector"` — text from descendant
 *    - `"css-selector|attr:name"` — attribute from descendant
 *    - `"_text"` — full text of the parent element
 *    - `"_regex:PATTERN"` — capture group 1 from full element text
 *
 * 2. **Object form** — when you need an extraction method that doesn't fit
 *    the shortcut (e.g., regex with non-default capture group, attribute on
 *    a specific selector with a transform applied after, etc.):
 *
 *    ```ts
 *    { selector: "p.member__address", extractionMethod: "text",
 *      transform: { type: "regex_replace", params: {...} } }
 *    ```
 *
 *    Object form supports the same shape as the top-level FieldMapping
 *    (selector + extractionMethod + attribute / regexPattern+regexGroup +
 *    transform), minus the fieldName/scope/required/defaultValue parts
 *    that don't apply at child scope.
 */
export type ChildFieldConfig =
  | string
  | {
      /** CSS selector relative to the matched element. Required for text /
       *  attribute / html. Optional for regex (defaults to the full
       *  element text). */
      selector?: string;
      /** Extraction method. Defaults to 'text' when a selector is given,
       *  'regex' when only a regexPattern is given. */
      extractionMethod?: ExtractionMethod;
      /** For extractionMethod='attribute': which attribute to read. */
      attribute?: string;
      /** For extractionMethod='regex': the pattern. */
      regexPattern?: string;
      /** For extractionMethod='regex': capture group (default: 1). */
      regexGroup?: number;
      /** Optional transform applied after extraction. */
      transform?: FieldTransform;
    };

export type ExtractionMethod =
  | "text"
  | "attribute"
  | "html"
  | "regex"
  | "constant"
  | "structured";

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
// TEXT EXTRACTION RULES (for PDF content)
// ============================================

/**
 * Extraction rules for plain text content (PDF, logs, etc.).
 * Uses regex patterns and line-based selectors instead of CSS selectors.
 * Produced by AI structural analysis of PDF text.
 */
export interface TextExtractionRuleSet {
  /** Regex or delimiter that separates individual items in the text */
  itemDelimiter: string;
  /** Field mappings: how to extract each field from an item block */
  fieldMappings: TextFieldMapping[];
  /** Optional: lines to skip from the beginning (e.g., headers) */
  skipLines?: number;
  /** Optional: regex to identify the start of the data section */
  dataSectionStart?: string;
  /** Optional: regex to identify the end of the data section */
  dataSectionEnd?: string;
  /** Free-form notes from the AI about the text structure */
  analysisNotes?: string;
}

/**
 * Mapping from a regex pattern or line position to a domain model field.
 */
export interface TextFieldMapping {
  /** The target field name (e.g., "title", "scheduledAt") */
  fieldName: string;
  /** Regex pattern to extract the value from the item text block */
  pattern: string;
  /** Which regex capture group to use (default: 1) */
  captureGroup?: number;
  /** Whether this field is required */
  required: boolean;
  /** Default value if extraction yields nothing */
  defaultValue?: string;
  /** Optional transform to apply after extraction */
  transform?: FieldTransform;
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
  sourceType?: "html_scrape" | "bulk_download" | "api" | "pdf" | "pdf_archive";

  /** Configuration for bulk_download sources (ZIP/CSV/TSV files) */
  bulk?: BulkDownloadConfig;

  /** Configuration for API sources (REST endpoints with pagination) */
  api?: ApiSourceConfig;

  /** Configuration for PDF sources (text extraction + AI analysis) */
  pdf?: PdfSourceConfig;

  /** Configuration for pdf_archive sources (paginated listing of dated PDF documents) */
  pdfArchive?: PdfArchiveConfig;

  /** Detail page extraction plan: maps domain field names to CSS selectors
   *  or structured field configs for array extraction.
   *  When provided, the detail crawler uses these directly instead of AI derivation.
   *  - String values: CSS selector (supports dot notation and "|attr:href" suffix)
   *  - Object values: structured array extraction (e.g., multiple offices) */
  detailFields?: Record<string, string | StructuredFieldConfig>;

  /**
   * Explicit extraction rules that bypass AI structural analysis entirely.
   * When provided, the pipeline uses these selectors directly — no LLM call,
   * no manifest generation, no self-heal loop.
   *
   * Use this when the page structure is known and stable, or when the local
   * LLM consistently generates wrong selectors for a specific site.
   */
  staticManifest?: {
    containerSelector: string;
    itemSelector: string;
    fieldMappings: FieldMapping[];
  };

  /**
   * Crawl depth from the seed `url`, used by sync handlers that walk a
   * site's link graph (currently civics — see issue #669).
   *
   *   `0` (default) — no crawl, fetch only the seed URL itself.
   *   `1`           — seed + every link on the seed page.
   *   `N`           — N hops from the seed.
   *
   * Crawling is scoped to the same host AND the same path prefix as
   * the seed (the prefix is everything up to the seed URL's last `/`).
   * Only `text/html` responses are visited; PDFs, images, and external
   * domains are ignored. The visited set prevents revisits.
   */
  crawlDepth?: number;

  /**
   * Cap on total pages a crawler will visit per sync run, regardless
   * of `crawlDepth`. Defaults to 20. Each page costs one LLM call, so
   * this bounds runtime + token spend during a crawl-based sync.
   */
  crawlMaxPages?: number;

  /**
   * Per-source override for the LLM `maxTokens` generation cap.
   * When set, supersedes the sync handler's hardcoded default for
   * any LLM call this source produces. Useful when one source needs
   * a much longer or shorter output than its siblings — e.g., the CA
   * Assembly glossary at ~150 terms easily emits 15-20k tokens, while
   * a how-a-bill-becomes-law page tops out near 5k.
   */
  llmMaxTokens?: number;

  /**
   * Per-source override for the LLM provider's per-call request
   * timeout (milliseconds). When set, supersedes the provider's
   * constructor-configured default for any LLM call this source
   * produces. Useful when a single source legitimately runs much
   * longer than the platform-wide default — e.g., civics-glossary
   * extraction on qwen3.5:9b can take 15-20 min, while bio gen
   * finishes in 2 min on the same hardware.
   */
  llmRequestTimeoutMs?: number;

  /**
   * Bill discovery configuration. When present, the bills-ingest handler
   * fetches the seed page once, extracts bill IDs using `navLinkPattern`,
   * and constructs status and votes URLs from the supplied templates —
   * bypassing generic BFS. Required for legislature sites (e.g. CA leginfo)
   * where the search results page lists hundreds of nav links at depth 0,
   * exhausting `crawlMaxPages` before any detail pages can be discovered.
   */
  billDiscovery?: BillDiscoveryConfig;
}

/**
 * Declarative bill discovery strategy for legislature sites whose search
 * results page links to per-bill navigation hubs rather than directly to
 * bill status or votes pages.
 */
export interface BillDiscoveryConfig {
  /**
   * Regex (as a string) applied to the decoded HTML of the seed page to
   * extract bill IDs. Capture group 1 must yield the bill ID.
   * Example for CA leginfo:
   *   "/faces/billNavClient\\.xhtml\\?bill_id=([^\"&\\s]+)"
   */
  navLinkPattern: string;

  /**
   * URL path + query template for the bill status page. Use `{bill_id}`
   * as the placeholder; the service prepends the seed URL's origin.
   * Example: "/faces/billStatusClient.xhtml?bill_id={bill_id}"
   */
  statusPageTemplate: string;

  /**
   * URL path + query template for the bill votes page. Same substitution
   * rules as `statusPageTemplate`.
   * Example: "/faces/billVotesClient.xhtml?bill_id={bill_id}"
   */
  votesPageTemplate: string;

  /**
   * Optional URL path + query template for the bill text page. When set,
   * the sync fetches this page before running LLM extraction to check
   * the "Date Published" timestamp. If the stored value matches, the bill
   * is skipped — avoiding a redundant LLM call for unchanged bills.
   * Example: "/faces/billTextClient.xhtml?bill_id={bill_id}"
   */
  textPageTemplate?: string;
}

/**
 * Configuration for `sourceType: 'pdf_archive'` — a paginated listing
 * page that links to a series of dated PDF documents. Each linked PDF
 * is fetched, pdf-parsed, and stored as a `Minutes` record on the
 * consumer side. Per-document parsing (text → action records) is a
 * downstream backend pass — this block carries no parser DSL.
 *
 * Cold-start work is bounded by `maxNew` (default 10) so the first
 * sync doesn't ingest years of historical archives.
 */
export interface PdfArchiveConfig {
  /** CSS selector for PDF anchor elements on the listing page. Each match yields a candidate document. */
  linkSelector: string;
  /** Regex applied to the link href (falling back to anchor text) to extract the document's date. Capture groups depend on `dateFormat`. */
  datePattern?: string;
  /** Date format hint for interpreting `datePattern` captures. Supported: 'MMDDYY' (3 captures: month, day, two-digit year — assumed 20YY), 'YYYY-MM-DD' (3 captures), 'MM/DD/YYYY' (3 captures). */
  dateFormat?: string;
  /** Regex against the link href whose match indicates this URL is a revision. Capture group 1 is the revision sequence number. Unmatched URLs are revisionSeq=0. */
  revisionPattern?: string;
  /** Maximum number of listing pages to walk during a single sync cycle. Default: 10. */
  maxPages?: number;
  /** Hard cap on number of new documents ingested per sync cycle. Cold-start protection. Default: 10. */
  maxNew?: number;
  /** Query parameter name used to paginate the listing page (e.g. 'page'). Omitted when the listing isn't paginated. */
  paginationParam?: string;
}

/**
 * Configuration for extracting an array of structured objects from repeating HTML sections.
 * Used in detailFields for things like multiple office locations.
 */
export interface StructuredFieldConfig {
  /** CSS selector matching each repeating item (e.g., ".office-card") */
  selector: string;
  /** Child field selectors relative to each item (e.g., { name: "h3", phone: ".phone" }) */
  children: Record<string, string>;
  /** If true, extracts all matches as an array (default: true) */
  multiple?: boolean;
}

/**
 * Configuration for PDF extraction sources.
 * PDF text is extracted and sent to the AI prompt service for
 * one-shot structured data extraction (no manifest/CSS selectors).
 */
export interface PdfSourceConfig {
  /** Skip first N pages (e.g., skip cover page) */
  skipPages?: number;
  /** Max pages to process (undefined = all) */
  maxPages?: number;
  /** If true, the URL is a gateway page — find the first PDF link and download that */
  followPdfLink?: boolean;
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
  /** Explicit column headers for files without a header row (e.g., FEC bulk files) */
  headers?: string[];
  /** Column name mappings: source column name → domain field name */
  columnMappings: Record<string, string>;
  /** Filter expressions applied during parse (e.g., { "STATE": "CA" }) */
  filters?: Record<string, string>;
  /** Batch size for streaming processing (default: 10,000). Records are
   *  mapped and persisted in batches of this size to avoid OOM on large files. */
  batchSize?: number;
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
  /** Field name mappings: API response field → domain model field (e.g., "committee_id" → "committeeId") */
  fieldMappings?: Record<string, string>;
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
  /** regionId of this region's parent (e.g., "california" for a CA county). Omit for top-level regions. */
  parentRegionId?: string;
  /** Census FIPS code: 2-digit for states, 5-digit for counties, 7-digit for places. Join key to PostGIS jurisdictions table. */
  fipsCode?: string;
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
  /** Extracted items (empty when using batch mode) */
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
  /** Total item count (useful in batch mode where items array is empty) */
  itemCount?: number;
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
