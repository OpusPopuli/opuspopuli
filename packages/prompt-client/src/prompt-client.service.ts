/**
 * Prompt Client Service
 *
 * Reads AI prompt templates from the database and composes them with variables.
 * When configured with a remote AI Prompt Service URL, delegates to the service
 * with HMAC request signing, circuit breaker protection, and retry logic.
 *
 * Fallback chain: remote → database → hardcoded defaults
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DbService } from "@opuspopuli/relationaldb-provider";
import type { PromptTemplate } from "@opuspopuli/relationaldb-provider";
import {
  CircuitBreakerManager,
  CircuitOpenError,
  CircuitState,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  MemoryCache,
  withRetry,
  RetryPredicates,
  type CircuitBreakerHealth,
  type ICache,
  type PromptServiceResponse,
} from "@opuspopuli/common";
import { signRequest, type HmacSigningConfig } from "./hmac-signer.js";
import { MetricsCollector, type PromptClientMetrics } from "./metrics.js";
import type {
  PromptClientConfig,
  StructuralAnalysisParams,
  DocumentAnalysisParams,
  RAGParams,
  CivicsExtractionParams,
  BillExtractionParams,
} from "./types.js";
import { PROMPT_CLIENT_CONFIG } from "./types.js";

/** Core template names that have hardcoded fallbacks. */
const CORE_TEMPLATE_NAMES = [
  "structural-analysis",
  "structural-schema-default",
  "document-analysis-generic",
  "document-analysis-base-instructions",
  "rag",
] as const;

/** Minimal fallback defaults so services can function without seeded DB. */
function buildFallbackTemplate(
  name: string,
  category: "structural_analysis" | "document_analysis" | "rag",
  templateText: string,
): PromptTemplate {
  return {
    id: `fallback-${name}`,
    name,
    category,
    description: "Hardcoded fallback — run db:seed-prompts for full version",
    templateText,
    variables: [],
    version: 0,
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const FALLBACK_TEMPLATES = new Map<string, PromptTemplate>([
  [
    "structural-analysis",
    buildFallbackTemplate(
      "structural-analysis",
      "structural_analysis",
      `You are a web scraping expert. Analyze the following HTML and produce extraction rules as JSON.
Given HTML from a web page, derive CSS selectors to extract {{DATA_TYPE}} data.
Content goal: {{CONTENT_GOAL}}
{{HINTS_SECTION}}
Target schema: {{SCHEMA_DESCRIPTION}}
Respond with ONLY valid JSON: {"containerSelector":"...","itemSelector":"...","fieldMappings":[{"fieldName":"...","selector":"...","extractionMethod":"text"}],"analysisNotes":"..."}
HTML:
\`\`\`html
{{HTML}}
\`\`\``,
    ),
  ],
  [
    "structural-schema-default",
    buildFallbackTemplate(
      "structural-schema-default",
      "structural_analysis",
      "Extract all relevant structured data fields from each item.",
    ),
  ],
  [
    "document-analysis-generic",
    buildFallbackTemplate(
      "document-analysis-generic",
      "document_analysis",
      `Analyze this document and extract key information.
DOCUMENT:
{{TEXT}}
Respond with JSON: {"summary":"...","keyPoints":["..."],"entities":["..."]}`,
    ),
  ],
  [
    "document-analysis-base-instructions",
    buildFallbackTemplate(
      "document-analysis-base-instructions",
      "document_analysis",
      "Respond with valid JSON only. No markdown, no explanations.",
    ),
  ],
  [
    "rag",
    buildFallbackTemplate(
      "rag",
      "rag",
      `Answer the question using ONLY information from the context below. If the context doesn't contain enough information, say so.
Context:
{{CONTEXT}}
Question: {{QUERY}}
Answer:`,
    ),
  ],
  [
    "bill-extraction",
    buildFallbackTemplate(
      "bill-extraction",
      "structural_analysis",
      `You are extracting structured data from an official state legislature bill page.
Region: {{REGION_ID}}
Source URL: {{SOURCE_URL}}
Legislative session: {{SESSION_YEAR}}

Extract the following fields from the HTML and respond with ONLY valid JSON:
{
  "billNumber": "AB 1234",
  "sessionYear": "2023-2024",
  "measureTypeCode": "AB",
  "title": "Full bill title",
  "subject": "Primary subject tag if present",
  "status": "Current status string as it appears on the page",
  "lastAction": "Most recent action description",
  "lastActionDate": "YYYY-MM-DD or null",
  "fiscalImpact": "Fiscal impact summary or null",
  "fullTextUrl": "URL to the bill full text or null",
  "authorName": "Primary author full name",
  "coAuthorNames": ["Co-author name 1", "Co-author name 2"],
  "committeeNames": ["Committee name 1"],
  "votes": [
    {
      "representativeName": "Member full name",
      "chamber": "Assembly",
      "voteDate": "YYYY-MM-DD",
      "position": "yes",
      "motionText": "Do Pass"
    }
  ]
}
Valid position values: yes | no | abstain | absent | excused | no_vote
Omit any field you cannot determine from the page. Do not fabricate data.
HTML:
\`\`\`html
{{HTML}}
\`\`\``,
    ),
  ],
]);

@Injectable()
export class PromptClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromptClientService.name);
  private readonly templateCache: ICache<PromptTemplate>;
  private readonly circuitBreaker?: CircuitBreakerManager;
  private readonly hmacConfig?: HmacSigningConfig;
  private readonly metrics = new MetricsCollector();
  private readonly retryConfig: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };

  constructor(
    private readonly db: DbService,
    @Optional()
    @Inject(PROMPT_CLIENT_CONFIG)
    private readonly config?: PromptClientConfig,
  ) {
    // Initialize template cache
    this.templateCache =
      config?.cache ??
      new MemoryCache<PromptTemplate>({
        ttlMs: config?.cacheTtlMs ?? 300000,
        maxSize: config?.cacheMaxSize ?? 50,
      });

    // Initialize circuit breaker (only when remote URL is configured)
    if (config?.promptServiceUrl) {
      const defaultCb = DEFAULT_CIRCUIT_CONFIGS.promptService;
      this.circuitBreaker = createCircuitBreaker({
        failureThreshold:
          config.circuitBreakerFailureThreshold ?? defaultCb.failureThreshold,
        halfOpenAfterMs:
          config.circuitBreakerHalfOpenMs ?? defaultCb.halfOpenAfterMs,
        serviceName: defaultCb.serviceName,
      });

      this.circuitBreaker.addListener((event) => {
        switch (event) {
          case "break":
            this.logger.warn("Circuit breaker OPENED for PromptService");
            break;
          case "reset":
            this.logger.log("Circuit breaker RESET for PromptService");
            break;
          case "half_open":
            this.logger.log("Circuit breaker HALF-OPEN for PromptService");
            break;
        }
      });

      this.logger.log(
        `Prompt client configured for remote service: ${config.promptServiceUrl}` +
          (config.hmacNodeId ? " (HMAC auth)" : " (Bearer auth)"),
      );
    } else {
      this.logger.log("Prompt client using database templates");
    }

    // Initialize HMAC config
    if (config?.hmacNodeId && config?.promptServiceApiKey) {
      this.hmacConfig = {
        apiKey: config.promptServiceApiKey,
        nodeId: config.hmacNodeId,
      };
    }

    // Initialize retry config
    this.retryConfig = {
      maxAttempts: config?.retryMaxAttempts ?? 3,
      baseDelayMs: config?.retryBaseDelayMs ?? 1000,
      maxDelayMs: config?.retryMaxDelayMs ?? 10000,
    };
  }

  async onModuleInit(): Promise<void> {
    if (this.config?.promptServiceUrl) return;

    const { missing } = await this.validateTemplates();
    if (missing.length === 0) {
      this.logger.log(
        `All ${CORE_TEMPLATE_NAMES.length} core prompt templates found in database`,
      );
    } else {
      this.logger.warn(
        `Missing ${missing.length} core prompt template(s) in database: ${missing.join(", ")}. ` +
          "Hardcoded fallbacks will be used. Run db:seed-prompts to populate.",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.templateCache.destroy();
  }

  /**
   * Check which core templates are present in the database.
   */
  async validateTemplates(): Promise<{
    healthy: boolean;
    missing: string[];
  }> {
    const missing: string[] = [];
    for (const name of CORE_TEMPLATE_NAMES) {
      const exists = await this.db.promptTemplate.findFirst({
        where: { name, isActive: true },
        select: { id: true },
      });
      if (!exists) missing.push(name);
    }
    return { healthy: missing.length === 0, missing };
  }

  /**
   * Get a structural analysis prompt.
   */
  async getStructuralAnalysisPrompt(
    params: StructuralAnalysisParams,
  ): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("structural-analysis", params);
    }
    return this.composeStructuralAnalysis(params);
  }

  /**
   * Get a document analysis prompt.
   */
  async getDocumentAnalysisPrompt(
    params: DocumentAnalysisParams,
  ): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("document-analysis", params);
    }
    return this.composeDocumentAnalysis(params);
  }

  /**
   * Get a RAG prompt.
   */
  async getRAGPrompt(params: RAGParams): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("rag", params);
    }
    return this.composeRag(params);
  }

  /**
   * Get a civics-extraction prompt — the LLM is instructed to emit
   * a `CivicsBlock` (chambers, measure types, lifecycle stages,
   * glossary, sessionScheme) where every text field has BOTH the
   * verbatim source text AND a plain-language rewrite for laypeople.
   *
   * See `@opuspopuli/common`'s `CivicsBlock` for the response shape
   * the LLM is told to produce. See OpusPopuli/opuspopuli#669.
   */
  async getCivicsExtractionPrompt(
    params: CivicsExtractionParams,
  ): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("civics-extraction", params);
    }
    return this.composeCivicsExtraction(params);
  }

  /**
   * Get a bill-extraction prompt — the LLM is instructed to emit a
   * structured `Bill` record (billNumber, title, status, author, votes,
   * etc.) from a single bill detail page on an official legislature
   * website. See `@opuspopuli/common`'s `Bill` for the response shape.
   * Issue #686.
   */
  async getBillExtractionPrompt(
    params: BillExtractionParams,
  ): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("bill-extraction", params);
    }
    return this.composeBillExtraction(params);
  }

  /**
   * Get the current prompt hash for cache invalidation.
   *
   * When configured with a remote prompt service, this hits GET
   * /prompts/:name/hash so the returned hash matches what the service
   * returns on prompt fetches (same bare-template SHA-256). This is the
   * authoritative source and must agree with the hash stored on any
   * manifest — otherwise the manifest cache will never hit.
   *
   * Falls back to hashing the local DB template when remote mode is not
   * configured or the remote call fails. The fallback path is degraded
   * (the local template may have drifted from the service) but preserves
   * availability.
   */
  async getPromptHash(templateName: string): Promise<string> {
    if (this.config?.promptServiceUrl) {
      try {
        return await this.fetchRemoteHash(templateName);
      } catch (error) {
        this.logger.warn(
          `Remote hash lookup failed for ${templateName}, falling back to local: ${(error as Error).message}`,
        );
      }
    }
    const template = await this.getTemplate(templateName);
    return this.hash(template.templateText);
  }

  private async fetchRemoteHash(templateName: string): Promise<string> {
    const url = this.config!.promptServiceUrl!;
    const timeout = this.config?.timeoutMs ?? 10000;
    const path = `/prompts/${encodeURIComponent(templateName)}/hash`;

    const headers: Record<string, string> = {};

    if (this.hmacConfig) {
      Object.assign(headers, signRequest(this.hmacConfig, "GET", path, ""));
    } else {
      const apiKey = this.config!.promptServiceApiKey;
      if (!apiKey) {
        throw new Error(
          "API key is required when prompt service URL is configured",
        );
      }
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await this.circuitBreaker!.execute(async () => {
      const res = await fetch(`${url}${path}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) {
        throw new Error(
          `Prompt service returned ${res.status}: ${res.statusText}`,
        );
      }
      return (await res.json()) as { promptHash: string };
    });

    return response.promptHash;
  }

  /**
   * Get current metrics snapshot.
   */
  getMetrics(): PromptClientMetrics {
    const state = this.circuitBreaker?.getState() ?? CircuitState.CLOSED;
    return this.metrics.getMetrics(state);
  }

  /**
   * Get circuit breaker health (null if remote mode is not configured).
   */
  getCircuitBreakerHealth(): CircuitBreakerHealth | null {
    return this.circuitBreaker?.getHealth() ?? null;
  }

  /**
   * Clear the template cache.
   */
  async clearCache(): Promise<void> {
    await this.templateCache.clear();
    this.logger.log("Template cache cleared");
  }

  // ---------------------------------------------------------------------------
  // Private: Remote fetch with resilience
  // ---------------------------------------------------------------------------

  /**
   * Fetch prompt from the remote AI Prompt Service with retry and circuit breaker.
   * Falls back to DB-based composition on failure.
   */
  private async fetchRemotePrompt(
    endpoint: string,
    params:
      | StructuralAnalysisParams
      | DocumentAnalysisParams
      | RAGParams
      | CivicsExtractionParams
      | BillExtractionParams,
  ): Promise<PromptServiceResponse> {
    const url = this.config!.promptServiceUrl!;
    const timeout = this.config?.timeoutMs ?? 10000;
    const body = JSON.stringify(params);
    const path = `/prompts/${endpoint}`;

    // Build headers: HMAC or Bearer
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.hmacConfig) {
      Object.assign(headers, signRequest(this.hmacConfig, "POST", path, body));
    } else {
      const apiKey = this.config!.promptServiceApiKey;
      if (!apiKey) {
        throw new Error(
          "API key is required when prompt service URL is configured",
        );
      }
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const startMs = Date.now();

    try {
      const result = await withRetry(
        () =>
          this.circuitBreaker!.execute(async () => {
            const response = await fetch(`${url}${path}`, {
              method: "POST",
              headers,
              body,
              signal: AbortSignal.timeout(timeout),
            });

            if (!response.ok) {
              throw new Error(
                `Prompt service returned ${response.status}: ${response.statusText}`,
              );
            }

            return (await response.json()) as PromptServiceResponse;
          }),
        {
          maxAttempts: this.retryConfig.maxAttempts,
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          isRetryable: (error) => {
            // Never retry when circuit is open — fail fast to DB fallback
            if (error instanceof CircuitOpenError) return false;
            // Only retry transient errors (network failures, 5xx)
            return (
              RetryPredicates.isNetworkError(error) ||
              RetryPredicates.isServerError(error)
            );
          },
          onRetry: (error, attempt, delayMs) => {
            this.logger.warn(
              `Retry attempt ${attempt} for ${endpoint} after ${delayMs}ms: ${error.message}`,
            );
          },
        },
      );

      this.metrics.recordRemoteCall(Date.now() - startMs);

      return result;
    } catch (error) {
      this.logger.warn(
        `Remote prompt service failed for ${endpoint}, falling back to DB: ${(error as Error).message}`,
      );
      return this.composeFromDb(endpoint, params);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: DB-based composition (fallback path)
  // ---------------------------------------------------------------------------

  /**
   * Route to the correct DB composition method based on endpoint.
   */
  private async composeFromDb(
    endpoint: string,
    params:
      | StructuralAnalysisParams
      | DocumentAnalysisParams
      | RAGParams
      | CivicsExtractionParams
      | BillExtractionParams,
  ): Promise<PromptServiceResponse> {
    this.metrics.recordDbFallback();
    switch (endpoint) {
      case "structural-analysis":
        return this.composeStructuralAnalysis(
          params as StructuralAnalysisParams,
        );
      case "document-analysis":
        return this.composeDocumentAnalysis(params as DocumentAnalysisParams);
      case "rag":
        return this.composeRag(params as RAGParams);
      case "civics-extraction":
        return this.composeCivicsExtraction(params as CivicsExtractionParams);
      case "bill-extraction":
        return this.composeBillExtraction(params as BillExtractionParams);
      default:
        throw new Error(`Unknown prompt endpoint: ${endpoint}`);
    }
  }

  private async composeStructuralAnalysis(
    params: StructuralAnalysisParams,
  ): Promise<PromptServiceResponse> {
    const template = await this.getTemplate("structural-analysis");
    const schemaTemplate = await this.getTemplate(
      `structural-schema-${params.dataType}`,
      `structural-schema-default`,
    );

    const hintsSection = params.hints?.length
      ? "## Hints from the region author\n" +
        params.hints.map((h) => "- " + h).join("\n") +
        "\n"
      : "";

    const promptText = this.interpolate(template.templateText, {
      DATA_TYPE: params.dataType,
      CONTENT_GOAL: params.contentGoal,
      CATEGORY: params.category ?? "",
      HINTS_SECTION: hintsSection,
      SCHEMA_DESCRIPTION: schemaTemplate.templateText,
      HTML: params.html,
    });

    return {
      promptText,
      promptHash: this.hash(template.templateText),
      promptVersion: `v${template.version}`,
    };
  }

  private async composeDocumentAnalysis(
    params: DocumentAnalysisParams,
  ): Promise<PromptServiceResponse> {
    const template = await this.getTemplate(
      `document-analysis-${params.documentType}`,
      "document-analysis-generic",
    );
    const baseInstructions = await this.getTemplate(
      "document-analysis-base-instructions",
    );

    const promptText =
      this.interpolate(template.templateText, { TEXT: params.text }) +
      "\n" +
      baseInstructions.templateText;

    return {
      promptText,
      promptHash: this.hash(template.templateText),
      promptVersion: `v${template.version}`,
    };
  }

  private async composeCivicsExtraction(
    params: CivicsExtractionParams,
  ): Promise<PromptServiceResponse> {
    const template = await this.getTemplate("civics-extraction");

    const hintsSection = params.hints?.length
      ? "## Hints from the region author\n" +
        params.hints.map((h) => "- " + h).join("\n") +
        "\n"
      : "";

    const promptText = this.interpolate(template.templateText, {
      REGION_ID: params.regionId,
      SOURCE_URL: params.sourceUrl,
      CONTENT_GOAL: params.contentGoal,
      CATEGORY: params.category ?? "",
      HINTS: hintsSection,
      HTML: params.html,
    });

    return {
      promptText,
      promptHash: this.hash(template.templateText),
      promptVersion: `v${template.version}`,
    };
  }

  private async composeBillExtraction(
    params: BillExtractionParams,
  ): Promise<PromptServiceResponse> {
    const template = await this.getTemplate("bill-extraction");

    const promptText = this.interpolate(template.templateText, {
      REGION_ID: params.regionId,
      SOURCE_URL: params.sourceUrl,
      SESSION_YEAR: params.sessionYear,
      HTML: params.html,
    });

    return {
      promptText,
      promptHash: this.hash(template.templateText),
      promptVersion: `v${template.version}`,
    };
  }

  private async composeRag(params: RAGParams): Promise<PromptServiceResponse> {
    const template = await this.getTemplate("rag");

    const promptText = this.interpolate(template.templateText, {
      CONTEXT: params.context,
      QUERY: params.query,
    });

    return {
      promptText,
      promptHash: this.hash(template.templateText),
      promptVersion: `v${template.version}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Template loading with caching
  // ---------------------------------------------------------------------------

  /**
   * Fetch a template from the database with caching and fallbacks.
   */
  private async getTemplate(
    name: string,
    fallbackName?: string,
  ): Promise<PromptTemplate> {
    // Check cache
    const cached = await this.templateCache.get(name);
    if (cached) return cached;

    // Query database
    let template = await this.db.promptTemplate.findFirst({
      where: { name, isActive: true },
    });

    if (!template && fallbackName) {
      template = await this.db.promptTemplate.findFirst({
        where: { name: fallbackName, isActive: true },
      });
    }

    if (!template) {
      // Check hardcoded fallbacks for core templates
      const fallback =
        FALLBACK_TEMPLATES.get(name) ??
        (fallbackName ? FALLBACK_TEMPLATES.get(fallbackName) : undefined);
      if (fallback) {
        this.logger.warn(
          `Using hardcoded fallback for "${name}" — run db:seed-prompts`,
        );
        this.metrics.recordHardcodedFallback();
        await this.templateCache.set(name, fallback);
        return fallback;
      }
      throw new Error(`Prompt template "${name}" not found in database`);
    }

    // Cache for future reads
    await this.templateCache.set(name, template);
    return template;
  }

  // ---------------------------------------------------------------------------
  // Private: Utilities
  // ---------------------------------------------------------------------------

  private interpolate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
  }

  private hash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }
}
