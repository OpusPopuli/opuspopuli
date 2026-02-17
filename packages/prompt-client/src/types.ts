/**
 * Prompt Client Types
 */

import type { DataType, PromptServiceResponse } from "@opuspopuli/common";

/**
 * Configuration for the prompt client.
 */
export interface PromptClientConfig {
  /** URL of future remote AI Prompt Service (undefined = read from DB) */
  promptServiceUrl?: string;
  /** API key — always required when url is set */
  promptServiceApiKey?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
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
