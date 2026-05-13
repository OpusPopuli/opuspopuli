/**
 * Prompt Client Types
 */

import type {
  DataType,
  PromptServiceResponse,
  ICache,
} from "@opuspopuli/common";
import type { PromptTemplate } from "@opuspopuli/relationaldb-provider";

/**
 * Configuration for the prompt client.
 */
export interface PromptClientConfig {
  /** URL of remote AI Prompt Service (undefined = read from DB) */
  promptServiceUrl?: string;
  /** API key — required when url is set (used for Bearer or HMAC signing) */
  promptServiceApiKey?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;

  /** Node UUID for HMAC signing. When set (along with apiKey), uses HMAC auth instead of Bearer. */
  hmacNodeId?: string;

  /** Max retry attempts for remote calls (default: 3) */
  retryMaxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  retryBaseDelayMs?: number;
  /** Max delay in ms between retries (default: 10000) */
  retryMaxDelayMs?: number;

  /** Failure threshold before opening circuit (default: 3) */
  circuitBreakerFailureThreshold?: number;
  /** Time in ms before testing half-open (default: 15000) */
  circuitBreakerHalfOpenMs?: number;

  /** External cache instance (e.g., Redis-backed). When undefined, uses MemoryCache. */
  cache?: ICache<PromptTemplate>;
  /** Cache TTL in ms for template entries (default: 300000 = 5 min) */
  cacheTtlMs?: number;
  /** Maximum in-memory cache entries (default: 50, only used for built-in MemoryCache) */
  cacheMaxSize?: number;
}

/**
 * Parameters for structural analysis prompt.
 */
export interface StructuralAnalysisParams {
  dataType: DataType;
  contentGoal: string;
  category?: string;
  hints?: string[];
  html: string;
}

/**
 * Parameters for document analysis prompt.
 */
export interface DocumentAnalysisParams {
  documentType: string;
  text: string;
}

/**
 * Parameters for RAG prompt.
 */
export interface RAGParams {
  context: string;
  query: string;
}

/**
 * Parameters for civics-extraction prompt — produces a structured
 * `CivicsBlock` with verbatim source text + plain-language rewrites
 * from a region's official civic-process pages.
 *
 * The LLM returns JSON matching `@opuspopuli/common`'s `CivicsBlock`
 * shape. Each text field that has a lay reading carries BOTH the
 * verbatim source text AND a plain-language rewrite for a typical
 * voter — never one without the other. See
 * OpusPopuli/opuspopuli#669 + OpusPopuli/opuspopuli-regions#15.
 */
export interface CivicsExtractionParams {
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** URL the HTML/text was scraped from (for citation in `CivicText.sourceUrl`). */
  sourceUrl: string;
  /** Natural-language extraction goal from the region config's `dataSource.contentGoal`. */
  contentGoal: string;
  /** Optional sub-category from the region config (e.g. "Assembly", "Senate"). */
  category?: string;
  /** Optional hints from the region config to disambiguate / scope extraction. */
  hints?: string[];
  /** Raw HTML or text content scraped from `sourceUrl`. */
  html: string;
}

/**
 * Parameters for bill-extraction prompt — produces a structured `Bill`
 * record from an individual bill page on an official legislature website
 * (leginfo.legislature.ca.gov for California). Issue #686.
 *
 * The LLM returns JSON matching `@opuspopuli/common`'s `Bill` shape,
 * including raw author/co-author name strings and a `votes[]` array of
 * per-member roll-call positions extracted from the bill's vote-history
 * section.
 */
export interface BillExtractionParams {
  /** Region identifier (e.g. "california"). */
  regionId: string;
  /** URL the HTML was scraped from — becomes Bill.sourceUrl. */
  sourceUrl: string;
  /** Legislative session inferred from the URL or page content, e.g. "2023-2024". */
  sessionYear: string;
  /** Raw HTML of the bill detail page. */
  html: string;
}

export const PROMPT_CLIENT_CONFIG = "PROMPT_CLIENT_CONFIG";

export type { PromptServiceResponse };
