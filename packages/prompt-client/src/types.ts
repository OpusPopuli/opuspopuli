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

export const PROMPT_CLIENT_CONFIG = "PROMPT_CLIENT_CONFIG";

export type { PromptServiceResponse };
