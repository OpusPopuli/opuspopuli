/**
 * Prompt Client Service
 *
 * Reads AI prompt templates from the database and composes them with variables.
 * In the future, can switch to a remote AI Prompt Service by setting the URL.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DbService } from "@opuspopuli/relationaldb-provider";
import type { PromptTemplate } from "@opuspopuli/relationaldb-provider";
import type { PromptServiceResponse } from "@opuspopuli/common";
import type {
  PromptClientConfig,
  StructuralAnalysisParams,
  DocumentAnalysisParams,
  RAGParams,
} from "./types.js";
import { PROMPT_CLIENT_CONFIG } from "./types.js";

@Injectable()
export class PromptClientService {
  private readonly logger = new Logger(PromptClientService.name);
  private readonly cache = new Map<string, PromptTemplate>();

  constructor(
    private readonly db: DbService,
    @Optional()
    @Inject(PROMPT_CLIENT_CONFIG)
    private readonly config?: PromptClientConfig,
  ) {
    if (this.config?.promptServiceUrl) {
      this.logger.log(
        `Prompt client configured for remote service: ${this.config.promptServiceUrl}`,
      );
    } else {
      this.logger.log("Prompt client using database templates");
    }
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

    // Read base template
    const template = await this.getTemplate("structural-analysis");

    // Read schema description for this data type
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

  /**
   * Get a document analysis prompt.
   */
  async getDocumentAnalysisPrompt(
    params: DocumentAnalysisParams,
  ): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("document-analysis", params);
    }

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

  /**
   * Get a RAG prompt.
   */
  async getRAGPrompt(params: RAGParams): Promise<PromptServiceResponse> {
    if (this.config?.promptServiceUrl) {
      return this.fetchRemotePrompt("rag", params);
    }

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

  /**
   * Get the current prompt hash for cache invalidation.
   */
  async getPromptHash(templateName: string): Promise<string> {
    const template = await this.getTemplate(templateName);
    return this.hash(template.templateText);
  }

  /**
   * Clear the in-memory template cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log("Template cache cleared");
  }

  /**
   * Fetch a template from the database with in-memory caching.
   * Falls back to a default template name if the primary is not found.
   */
  private async getTemplate(
    name: string,
    fallbackName?: string,
  ): Promise<PromptTemplate> {
    // Check cache
    const cached = this.cache.get(name);
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
      throw new Error(`Prompt template "${name}" not found in database`);
    }

    // Cache for future reads
    this.cache.set(name, template);
    return template;
  }

  /**
   * Interpolate {{VARIABLE}} placeholders in a template.
   */
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

  /**
   * Hash a template string for cache invalidation tracking.
   */
  private hash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  /**
   * Fetch prompt from a remote AI Prompt Service.
   */
  private async fetchRemotePrompt(
    endpoint: string,
    params: StructuralAnalysisParams | DocumentAnalysisParams | RAGParams,
  ): Promise<PromptServiceResponse> {
    const url = this.config!.promptServiceUrl!;
    const apiKey = this.config!.promptServiceApiKey;
    const timeout = this.config?.timeoutMs ?? 10000;

    if (!apiKey) {
      throw new Error(
        "API key is required when prompt service URL is configured",
      );
    }

    const response = await fetch(`${url}/prompts/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new Error(
        `Prompt service returned ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as PromptServiceResponse;
  }
}
