/**
 * Prompt Client Service
 *
 * Reads AI prompt templates and composes them with variables. When configured
 * with a remote AI Prompt Service URL, fetches the RAW TEMPLATE once via
 * `GET /prompts/:name`, caches it locally for the server-supplied TTL, and
 * interpolates locally on every call — eliminating the per-bill / per-doc
 * round-trip the older `POST /prompts/<endpoint>` flow required. Stale
 * entries revalidate cheaply via `GET /:name/hash` before being refetched.
 *
 * Fallback chain (per call): remote template cache → remote template fetch →
 * local database → hardcoded defaults.
 *
 * See `OpusPopuli/prompt-service#66` (server endpoint) and
 * `OpusPopuli/opuspopuli#729` (this client work).
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

/**
 * Cached payload from `GET /prompts/:name`. The wrapped `template` is
 * shaped like a `PromptTemplate` so the existing composeXxx pipeline works
 * unchanged; `expiresAtMs` and `hash` are used by the cache layer for
 * freshness checks and revalidation.
 */
interface RemoteCachedTemplate {
  template: PromptTemplate;
  hash: string;
  expiresAtMs: number;
}
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
  /**
   * Cache for raw templates fetched from the remote prompt-service. Keyed
   * by template name. The cached entry's `expiresAtMs` is the server's
   * `expiresAt` (not the cache's own TTL); past that, we revalidate via
   * `/:name/hash` before refetching the full template. See #729.
   */
  private readonly remoteCache: ICache<RemoteCachedTemplate>;
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
    // Initialize template cache (DB-mode + hardcoded fallback path)
    this.templateCache =
      config?.cache ??
      new MemoryCache<PromptTemplate>({
        ttlMs: config?.cacheTtlMs ?? 300000,
        maxSize: config?.cacheMaxSize ?? 50,
      });

    // Initialize remote template cache. Its own MemoryCache TTL is an upper
    // bound; per-entry freshness is governed by the server's `expiresAt`
    // (typically 1 hour), so we set the cache TTL generously above that.
    this.remoteCache = new MemoryCache<RemoteCachedTemplate>({
      ttlMs: config?.remoteCacheMaxTtlMs ?? 24 * 60 * 60 * 1000, // 24h default
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
    await this.remoteCache.destroy();
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

  // The public API methods all delegate to the same composeXxx pipeline.
  // composeXxx pulls templates via getTemplate(), which transparently
  // serves the remote-cache path when promptServiceUrl is configured and
  // the DB+hardcoded path otherwise. Local interpolation happens in this
  // process — no per-call POST to the prompt-service. See #729.

  async getStructuralAnalysisPrompt(
    params: StructuralAnalysisParams,
  ): Promise<PromptServiceResponse> {
    return this.composeStructuralAnalysis(params);
  }

  async getDocumentAnalysisPrompt(
    params: DocumentAnalysisParams,
  ): Promise<PromptServiceResponse> {
    return this.composeDocumentAnalysis(params);
  }

  async getRAGPrompt(params: RAGParams): Promise<PromptServiceResponse> {
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

  /**
   * Build the auth headers (HMAC-signed or Bearer) for a request to the
   * prompt service. Throws if neither HMAC nor Bearer is configured.
   */
  private buildAuthHeaders(
    method: "GET" | "POST",
    path: string,
    body: string = "",
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.hmacConfig) {
      Object.assign(headers, signRequest(this.hmacConfig, method, path, body));
      return headers;
    }
    const apiKey = this.config!.promptServiceApiKey;
    if (!apiKey) {
      throw new Error(
        "API key is required when prompt service URL is configured",
      );
    }
    headers["Authorization"] = `Bearer ${apiKey}`;
    return headers;
  }

  /**
   * Execute a GET against the prompt service through the circuit breaker.
   * Throws on non-OK status; parses the JSON body into T on success.
   */
  private async executeAuthedGet<T>(
    url: string,
    path: string,
    headers: Record<string, string>,
    timeout: number,
  ): Promise<T> {
    return this.circuitBreaker!.execute(async () => {
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
      return (await res.json()) as T;
    });
  }

  private async fetchRemoteHash(templateName: string): Promise<string> {
    const url = this.config!.promptServiceUrl!;
    const timeout = this.config?.timeoutMs ?? 10000;
    const path = `/prompts/${encodeURIComponent(templateName)}/hash`;
    const headers = this.buildAuthHeaders("GET", path);

    const response = await this.executeAuthedGet<{ promptHash: string }>(
      url,
      path,
      headers,
      timeout,
    );

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
   * Clear all template caches (DB-mode cache + remote-mode cache).
   */
  async clearCache(): Promise<void> {
    await this.templateCache.clear();
    await this.remoteCache.clear();
    this.logger.log("Template cache cleared");
  }

  // ---------------------------------------------------------------------------
  // Private: Composition pipeline (one method per endpoint).
  // Each calls getTemplate() — which transparently serves the remote cache,
  // a remote fetch, or the DB+hardcoded fallback chain.
  // ---------------------------------------------------------------------------

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
  // Private: Template loading
  //
  // Single entry point for the composeXxx methods. Tries the remote cache /
  // remote fetch path first when configured, falls through to DB+hardcoded
  // on any remote failure. The fall-through is silent in steady state —
  // it's the same chain the DB-mode deployment uses (see #729).
  // ---------------------------------------------------------------------------

  /**
   * Fetch a template, trying remote (cached) → remote (fetch) → DB →
   * hardcoded fallback in order. Returns a `PromptTemplate`-shaped object
   * so existing composeXxx pipelines work unchanged.
   */
  private async getTemplate(
    name: string,
    fallbackName?: string,
  ): Promise<PromptTemplate> {
    if (this.config?.promptServiceUrl) {
      // Configuration errors throw — never fall through silently, that
      // would mask deployment misconfigurations as if they were healthy
      // operation. (Network errors below DO fall through; those are
      // legitimate transient failures.)
      if (!this.config.promptServiceApiKey && !this.hmacConfig) {
        throw new Error(
          "API key is required when prompt service URL is configured",
        );
      }
      try {
        return await this.fetchRawTemplate(name, fallbackName);
      } catch (error) {
        this.logger.warn(
          `Remote template fetch failed for "${name}", falling back to DB: ${(error as Error).message}`,
        );
        // fall through to DB+hardcoded chain
      }
    }

    return this.getTemplateFromDb(name, fallbackName);
  }

  /**
   * DB + hardcoded fallback chain. Used when remote mode is off, OR when
   * the remote fetch failed (network blip, circuit open, etc.). This is
   * the resilience layer — preserves availability through outages.
   */
  private async getTemplateFromDb(
    name: string,
    fallbackName?: string,
  ): Promise<PromptTemplate> {
    // Check DB-path cache
    const cached = await this.templateCache.get(name);
    if (cached) {
      this.metrics.recordCacheHit();
      return cached;
    }

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
      // Hardcoded fallbacks for core templates
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

    this.metrics.recordDbFallback();
    await this.templateCache.set(name, template);
    return template;
  }

  // ---------------------------------------------------------------------------
  // Private: Remote template fetch with caching + hash-revalidation (#729).
  // ---------------------------------------------------------------------------

  /**
   * Fetch a template from the remote prompt-service with cache + freshness
   * revalidation. Tries `name` first, falls back to `fallbackName` on 404.
   */
  private async fetchRawTemplate(
    name: string,
    fallbackName?: string,
  ): Promise<PromptTemplate> {
    try {
      return await this.fetchOneRawTemplate(name);
    } catch (err) {
      // 404 → try the configured fallback name (e.g. structural-schema-default).
      // For non-404 errors, propagate so the caller falls through to DB.
      const message = (err as Error).message;
      if (fallbackName && message.includes("404")) {
        return await this.fetchOneRawTemplate(fallbackName);
      }
      throw err;
    }
  }

  private async fetchOneRawTemplate(name: string): Promise<PromptTemplate> {
    const cached = await this.remoteCache.get(name);

    // Fresh cache hit — no network call at all.
    if (cached && Date.now() < cached.expiresAtMs) {
      this.metrics.recordTemplateCacheHit();
      return cached.template;
    }

    // Stale-but-cached: cheap hash check before refetching the full template.
    if (cached) {
      try {
        const currentHash = await this.fetchRemoteHash(name);
        if (currentHash === cached.hash) {
          // Template unchanged on the server — refresh local TTL and reuse.
          const refreshed: RemoteCachedTemplate = {
            ...cached,
            expiresAtMs: Date.now() + this.defaultRemoteTtlMs(),
          };
          await this.remoteCache.set(name, refreshed);
          this.metrics.recordTemplateCacheHit();
          return refreshed.template;
        }
        // Hash differs — fall through to refetch.
      } catch (err) {
        this.logger.warn(
          `Hash revalidation failed for "${name}", refetching: ${(err as Error).message}`,
        );
      }
    }

    // Full fetch
    const startMs = Date.now();
    const fetched = await this.fetchRemoteTemplate(name);
    this.metrics.recordRemoteCall(Date.now() - startMs);
    await this.remoteCache.set(name, fetched);
    return fetched.template;
  }

  /**
   * Hit `GET /prompts/:name` and return a `RemoteCachedTemplate` ready for
   * the cache. Retry + circuit breaker wrap the network call.
   */
  private async fetchRemoteTemplate(
    name: string,
  ): Promise<RemoteCachedTemplate> {
    const url = this.config!.promptServiceUrl!;
    const timeout = this.config?.timeoutMs ?? 10000;
    const path = `/prompts/${encodeURIComponent(name)}`;
    const headers = this.buildAuthHeaders("GET", path);

    const result = await withRetry(
      () =>
        this.executeAuthedGet<{
          name: string;
          templateText: string;
          variables: string[];
          promptHash: string;
          promptVersion: string;
          expiresAt: string;
          experimentId: string | null;
          variantName: string | null;
        }>(url, path, headers, timeout),
      {
        maxAttempts: this.retryConfig.maxAttempts,
        baseDelayMs: this.retryConfig.baseDelayMs,
        maxDelayMs: this.retryConfig.maxDelayMs,
        isRetryable: (error) => {
          if (error instanceof CircuitOpenError) return false;
          return (
            RetryPredicates.isNetworkError(error) ||
            RetryPredicates.isServerError(error)
          );
        },
        onRetry: (error, attempt, delayMs) => {
          this.logger.warn(
            `Retry attempt ${attempt} for template ${name} after ${delayMs}ms: ${error.message}`,
          );
        },
      },
    );

    const versionNum = Number.parseInt(
      result.promptVersion.replace(/^v/, ""),
      10,
    );

    // `category` isn't carried over the wire — it's only read by admin UI
    // tooling, never by composeXxx — so we pick a generic value here. The
    // PromptCategory enum is closed and doesn't have a 'remote' variant;
    // we keep `structural_analysis` as a benign default for cached entries
    // that never get written back to the DB.
    const template: PromptTemplate = {
      id: `remote-${name}`,
      name: result.name,
      category: "structural_analysis" as PromptTemplate["category"],
      description: "Fetched from remote prompt-service",
      templateText: result.templateText,
      variables: result.variables,
      version: Number.isNaN(versionNum) ? 0 : versionNum,
      isActive: true,
      createdAt: new Date(0),
      updatedAt: new Date(),
    };

    return {
      template,
      hash: result.promptHash,
      expiresAtMs: new Date(result.expiresAt).getTime(),
    };
  }

  private defaultRemoteTtlMs(): number {
    // Fallback when revalidating: use the configured TTL (default 5 min).
    // Server-supplied expiresAt is preferred on the initial fetch; this is
    // only used after a successful hash-revalidation to extend the entry.
    return this.config?.cacheTtlMs ?? 300000;
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
