/**
 * Structural Analyzer Service
 *
 * Analyzes HTML structure using an LLM to produce extraction rules.
 * The most critical component of the pipeline — the AI derives CSS
 * selectors and field mappings from raw HTML.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import { createHash, randomUUID } from "node:crypto";
import type { ILLMProvider } from "@opuspopuli/common";
import type {
  CivicDataType,
  DataSourceConfig,
  ExtractionRuleSet,
  StructuralManifest,
} from "@opuspopuli/common";
import { computeStructureHash } from "./structure-hasher.js";
import { PromptClientService } from "./prompt-client.service.js";

/** Maximum HTML size to send to the LLM (characters) */
const MAX_HTML_SIZE = 12000;

/** Elements to strip before analysis (non-content) */
const STRIP_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "link[rel=stylesheet]",
  "meta",
] as const;

@Injectable()
export class StructuralAnalyzerService {
  private readonly logger = new Logger(StructuralAnalyzerService.name);

  constructor(
    @Inject("LLM_PROVIDER") private readonly llm: ILLMProvider,
    private readonly promptClient: PromptClientService,
  ) {}

  /**
   * Analyze HTML and produce a structural manifest.
   *
   * @param html - Raw HTML content
   * @param source - Data source configuration
   * @returns A new structural manifest with AI-derived extraction rules
   */
  async analyze(
    html: string,
    source: DataSourceConfig,
  ): Promise<StructuralManifest> {
    const startTime = Date.now();

    // 1. Simplify HTML for analysis
    const simplified = this.simplifyHtml(html);

    // 2. Truncate to fit context window
    const truncated = this.smartTruncate(simplified, MAX_HTML_SIZE);

    // 3. Get prompt from the prompt service (remote or local)
    const promptResponse = await this.promptClient.getStructuralAnalysisPrompt(
      source,
      truncated,
    );

    // 4. Call LLM with low temperature for deterministic JSON output
    this.logger.log(
      `Running structural analysis for ${source.url} (${source.dataType})`,
    );

    const result = await this.llm.generate(promptResponse.promptText, {
      maxTokens: 2048,
      temperature: 0.1,
      topP: 0.95,
    });

    // 5. Parse and validate the JSON response
    const rules = this.parseExtractionRules(result.text);

    const analysisTimeMs = Date.now() - startTime;

    this.logger.log(
      `Structural analysis complete for ${source.url}: ${rules.fieldMappings.length} fields, ${analysisTimeMs}ms`,
    );

    // 6. Build manifest
    return {
      id: randomUUID(),
      regionId: "", // Set by caller
      sourceUrl: source.url,
      dataType: source.dataType,
      version: 0, // Set by caller
      structureHash: computeStructureHash(html),
      promptHash: promptResponse.promptHash,
      extractionRules: rules,
      confidence: this.estimateConfidence(rules),
      successCount: 0,
      failureCount: 0,
      isActive: true,
      llmProvider: this.llm.getName(),
      llmModel: this.llm.getModelName(),
      llmTokensUsed: result.tokensUsed,
      analysisTimeMs,
      createdAt: new Date(),
    };
  }

  /**
   * Get the current prompt hash for cache invalidation.
   */
  async getCurrentPromptHash(dataType: CivicDataType): Promise<string> {
    return this.promptClient.getPromptHash(dataType);
  }

  /**
   * Simplify HTML by removing scripts, styles, comments, and irrelevant attributes.
   * Keeps the structural layout and text content needed for analysis.
   */
  private simplifyHtml(html: string): string {
    const $ = cheerio.load(html);

    // Remove non-content elements
    for (const selector of STRIP_ELEMENTS) {
      $(selector).remove();
    }

    // Remove HTML comments
    $("*")
      .contents()
      .filter(function () {
        return this.type === "comment";
      })
      .remove();

    // Remove data-* attributes, inline styles, and event handlers
    $("*").each(function () {
      const el = this as unknown as { attribs?: Record<string, string> };
      const attribs = el.attribs ?? {};
      for (const attr of Object.keys(attribs)) {
        if (
          attr.startsWith("data-") ||
          attr === "style" ||
          attr.startsWith("on")
        ) {
          $(this).removeAttr(attr);
        }
      }
    });

    return $("body").html() || "";
  }

  /**
   * Smart truncation that preserves the most relevant content area.
   * Tries to keep the main content region intact.
   */
  private smartTruncate(html: string, maxSize: number): string {
    if (html.length <= maxSize) {
      return html;
    }

    // Try to find and keep the main content area
    const $ = cheerio.load(html);
    const mainSelectors = [
      "main",
      "#content",
      "#main-content",
      ".content",
      "article",
      "[role=main]",
    ];

    for (const selector of mainSelectors) {
      const main = $(selector);
      if (main.length > 0) {
        const mainHtml = main.html() || "";
        if (mainHtml.length <= maxSize) {
          return mainHtml;
        }
        // If main content is still too large, truncate it
        return mainHtml.substring(0, maxSize);
      }
    }

    // Fallback: simple truncation
    return html.substring(0, maxSize);
  }

  /**
   * Parse the LLM response into a validated ExtractionRuleSet.
   */
  private parseExtractionRules(llmOutput: string): ExtractionRuleSet {
    // Extract JSON from the response (LLM might wrap in markdown code blocks)
    let jsonStr = llmOutput.trim();

    // Strip markdown code block if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object boundaries
    const startIdx = jsonStr.indexOf("{");
    const endIdx = jsonStr.lastIndexOf("}");
    if (startIdx >= 0 && endIdx > startIdx) {
      jsonStr = jsonStr.substring(startIdx, endIdx + 1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (error) {
      throw new Error(
        `Failed to parse LLM output as JSON: ${(error as Error).message}. Output: ${llmOutput.substring(0, 200)}...`,
      );
    }

    // Validate required fields
    const rules = parsed as Record<string, unknown>;
    if (
      !rules.containerSelector ||
      typeof rules.containerSelector !== "string"
    ) {
      throw new Error("LLM output missing required field: containerSelector");
    }
    if (!rules.itemSelector || typeof rules.itemSelector !== "string") {
      throw new Error("LLM output missing required field: itemSelector");
    }
    if (
      !Array.isArray(rules.fieldMappings) ||
      rules.fieldMappings.length === 0
    ) {
      throw new Error("LLM output missing or empty: fieldMappings");
    }

    return rules as unknown as ExtractionRuleSet;
  }

  /**
   * Estimate confidence based on the quality of the extraction rules.
   */
  private estimateConfidence(rules: ExtractionRuleSet): number {
    let score = 0.5; // Base score

    // More field mappings = more thorough analysis
    if (rules.fieldMappings.length >= 3) score += 0.1;
    if (rules.fieldMappings.length >= 5) score += 0.1;

    // Having required fields is good
    const hasRequired = rules.fieldMappings.some((m) => m.required);
    if (hasRequired) score += 0.1;

    // Class-based selectors are more specific than tag-based
    const hasClassSelectors =
      rules.containerSelector.includes(".") || rules.itemSelector.includes(".");
    if (hasClassSelectors) score += 0.1;

    // Analysis notes suggest the LLM understood the structure
    if (rules.analysisNotes && rules.analysisNotes.length > 20) score += 0.1;

    return Math.min(score, 1.0);
  }
}
