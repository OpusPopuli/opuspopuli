/**
 * Prompt Client Service
 *
 * Client for the private AI Prompt Service API.
 * In production, prompts are served by a proprietary service.
 * For local development, falls back to a simple built-in template.
 */

import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  DataType,
  DataSourceConfig,
  PromptServiceResponse,
} from "@opuspopuli/common";

export interface PromptClientConfig {
  /** URL of the AI Prompt Service (undefined = use local fallback) */
  promptServiceUrl?: string;
  /** API key for the prompt service */
  promptServiceApiKey?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

@Injectable()
export class PromptClientService {
  private readonly logger = new Logger(PromptClientService.name);
  private readonly config: PromptClientConfig;

  constructor(config?: PromptClientConfig) {
    this.config = config ?? {};
    if (this.config.promptServiceUrl) {
      this.logger.log(
        `Prompt client configured for remote service: ${this.config.promptServiceUrl}`,
      );
    } else {
      this.logger.log(
        "Prompt client using local fallback templates (development mode)",
      );
    }
  }

  /**
   * Get a structural analysis prompt for the given source.
   *
   * In production: calls the private AI Prompt Service API.
   * In development: uses a built-in local template.
   *
   * @param source - The data source configuration
   * @param simplifiedHtml - Preprocessed HTML for analysis
   * @returns Prompt text and hash for cache invalidation
   */
  async getStructuralAnalysisPrompt(
    source: DataSourceConfig,
    simplifiedHtml: string,
  ): Promise<PromptServiceResponse> {
    if (this.config.promptServiceUrl) {
      return this.fetchRemotePrompt(source, simplifiedHtml);
    }

    return this.buildLocalPrompt(source, simplifiedHtml);
  }

  /**
   * Get the current prompt hash for a data type.
   * Used to detect prompt version changes for cache invalidation.
   */
  async getPromptHash(dataType: DataType): Promise<string> {
    // For local prompts, hash the template
    const template = this.getLocalTemplate(dataType);
    return createHash("sha256").update(template).digest("hex");
  }

  /**
   * Fetch prompt from the remote AI Prompt Service.
   */
  private async fetchRemotePrompt(
    source: DataSourceConfig,
    simplifiedHtml: string,
  ): Promise<PromptServiceResponse> {
    const timeout = this.config.timeoutMs ?? 10000;

    const response = await fetch(
      `${this.config.promptServiceUrl}/prompts/structural-analysis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.promptServiceApiKey
            ? { Authorization: `Bearer ${this.config.promptServiceApiKey}` }
            : {}),
        },
        body: JSON.stringify({
          dataType: source.dataType,
          contentGoal: source.contentGoal,
          category: source.category,
          hints: source.hints,
          html: simplifiedHtml,
        }),
        signal: AbortSignal.timeout(timeout),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Prompt service returned ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as PromptServiceResponse;
  }

  /**
   * Build a prompt locally using built-in templates.
   * Good enough for development and testing, but not production quality.
   */
  private buildLocalPrompt(
    source: DataSourceConfig,
    simplifiedHtml: string,
  ): PromptServiceResponse {
    const template = this.getLocalTemplate(source.dataType);
    const schemaDescription = this.getSchemaDescription(source.dataType);
    const hintsSection = source.hints?.length
      ? "## Hints from the region author\n" +
        source.hints.map((h) => "- " + h).join("\n") +
        "\n"
      : "";

    const promptText = template
      .replace("{{DATA_TYPE}}", source.dataType)
      .replace("{{CONTENT_GOAL}}", source.contentGoal)
      .replace("{{CATEGORY}}", source.category ?? "")
      .replace("{{HINTS_SECTION}}", hintsSection)
      .replace("{{SCHEMA_DESCRIPTION}}", schemaDescription)
      .replace("{{HTML}}", simplifiedHtml);

    const promptHash = createHash("sha256").update(template).digest("hex");

    return {
      promptText,
      promptHash,
      promptVersion: "local-dev-v1",
    };
  }

  /**
   * Get the local template for a data type.
   */
  private getLocalTemplate(dataType: DataType): string {
    return LOCAL_BASE_TEMPLATE;
  }

  /**
   * Get the schema description for a data type.
   */
  private getSchemaDescription(dataType: DataType): string {
    return SCHEMA_DESCRIPTIONS[dataType] ?? SCHEMA_DESCRIPTIONS.default;
  }
}

/**
 * Local development prompt template.
 * Production prompts live in the private AI Prompt Service.
 */
const LOCAL_BASE_TEMPLATE = `You are a web scraping expert. Analyze the following HTML and produce extraction rules as JSON.

## Task
Given the HTML from a web page, derive CSS selectors and extraction rules to extract {{DATA_TYPE}} data.

## Content Goal
{{CONTENT_GOAL}}

{{HINTS_SECTION}}

## Target Schema
The extracted data must conform to this structure:
{{SCHEMA_DESCRIPTION}}

## Required Output Format
Respond with ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "containerSelector": "CSS selector for the element containing all items",
  "itemSelector": "CSS selector for each individual item (relative to container)",
  "fieldMappings": [
    {
      "fieldName": "the target field name",
      "selector": "CSS selector relative to the item",
      "extractionMethod": "text|attribute|html|regex",
      "attribute": "only if extractionMethod is 'attribute'",
      "regexPattern": "only if extractionMethod is 'regex'",
      "regexGroup": 1,
      "transform": { "type": "transform_type", "params": {} },
      "required": true,
      "defaultValue": "fallback if empty"
    }
  ],
  "pagination": { "type": "none", "maxPages": 1 },
  "preprocessing": [],
  "analysisNotes": "Brief notes about the page structure"
}

## Rules
1. Use the MOST SPECIFIC CSS selectors available (prefer classes over tag names)
2. Field selectors are RELATIVE to each item element
3. Required fields MUST have selectors that match elements in the HTML
4. Use "regex" extractionMethod when text needs pattern extraction
5. Use transforms for date parsing, name formatting, URL resolution
6. If the page has multiple formats (e.g., table AND heading-based), choose the PRIMARY format
7. The containerSelector should match exactly ONE element
8. The itemSelector should match MULTIPLE elements within the container

## HTML to Analyze
\`\`\`html
{{HTML}}
\`\`\``;

const SCHEMA_DESCRIPTIONS: Record<string, string> = {
  propositions: `Each proposition/ballot measure has:
- externalId (required): Unique measure identifier (e.g., "ACA-13", "SB-42", "PROP-36")
- title (required): Measure title or description
- summary (optional): Longer summary or full description text
- status (optional): Current status (default: "pending")
- electionDate (optional): Date of the election (use date_parse transform)
- sourceUrl (optional): URL to source document or PDF`,

  meetings: `Each meeting/hearing has:
- externalId (required): Unique meeting identifier
- title (required): Committee name or meeting title
- body (optional): Legislative body (e.g., "Assembly", "Senate")
- scheduledAt (required): Date and time of the meeting (use date_parse transform)
- location (optional): Physical location
- agendaUrl (optional): URL to the meeting agenda`,

  representatives: `Each representative/legislator has:
- externalId (required): Unique identifier (e.g., "ca-assembly-30")
- name (required): Full name of the representative (use name_format transform if "Last, First")
- chamber (optional): Legislative chamber (e.g., "Assembly", "Senate")
- district (required): District identifier (e.g., "District 30")
- party (required): Political party (Democratic, Republican, Independent)
- photoUrl (optional): URL to profile photo (attribute extraction on img src)
- contactInfo.website (optional): Profile page URL (attribute extraction on anchor href)`,

  default: `Extract all relevant structured data fields from each item.`,
};
