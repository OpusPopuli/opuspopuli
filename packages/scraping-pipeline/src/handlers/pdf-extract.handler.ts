/**
 * PDF Extract Handler
 *
 * Downloads a PDF (or follows a link from a gateway page to find one),
 * extracts text using ExtractionProvider.extractPdfText(), then uses
 * AI structural analysis to produce text extraction rules and extract
 * structured data.
 *
 * Unlike the HTML scrape handler, this uses TextExtractorService
 * (regex/line-based) instead of ManifestExtractorService (CSS selectors).
 */

import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import type {
  DataSourceConfig,
  ExtractionResult,
  TextExtractionRuleSet,
} from "@opuspopuli/common";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";
import { TextExtractorService } from "../extraction/text-extractor.service.js";
import {
  extractJsonObjectSlice,
  stripCodeFences,
} from "../utils/json-salvage.js";

/** Maximum text size to send to the LLM (characters) */
const MAX_TEXT_SIZE = 12000;

@Injectable()
export class PdfExtractHandler {
  private readonly logger = new Logger(PdfExtractHandler.name);

  constructor(
    private readonly mapper: DomainMapperService,
    private readonly textExtractor: TextExtractorService,
  ) {}

  async execute<T>(
    source: DataSourceConfig,
    _regionId: string,
    llm: {
      generate: (
        prompt: string,
        options?: Record<string, unknown>,
      ) => Promise<{ text: string; tokensUsed?: number }>;
    },
    pdfTextExtractor: (url: string) => Promise<string>,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Resolve the actual PDF URL (may need to follow a gateway page link)
      let pdfUrl = source.url;
      if (source.pdf?.followPdfLink) {
        pdfUrl = await this.resolvePdfLink(source.url);
        this.logger.log(`Resolved PDF link: ${pdfUrl}`);
      }

      // 2. Extract text from PDF
      this.logger.log(`Extracting text from PDF: ${pdfUrl}`);
      const pdfText = await pdfTextExtractor(pdfUrl);

      if (!pdfText || pdfText.trim().length === 0) {
        errors.push("PDF text extraction returned empty content");
        return this.emptyResult(errors, warnings, pipelineStart);
      }

      this.logger.log(`Extracted ${pdfText.length} characters from PDF`);

      // 3. Truncate for LLM analysis
      const truncated =
        pdfText.length > MAX_TEXT_SIZE
          ? pdfText.slice(0, MAX_TEXT_SIZE) + "\n\n[... truncated ...]"
          : pdfText;

      // 4. Ask AI to produce text extraction rules
      const prompt = this.buildAnalysisPrompt(source, truncated);
      const llmResult = await llm.generate(prompt, {
        maxTokens: 2048,
        temperature: 0.1,
        topP: 0.95,
      });

      // 5. Parse extraction rules from AI response
      const rules = this.parseTextExtractionRules(llmResult.text);
      if (!rules) {
        errors.push("AI failed to produce valid text extraction rules");
        return this.emptyResult(errors, warnings, pipelineStart);
      }

      this.logger.log(
        `AI produced ${rules.fieldMappings.length} field mappings for text extraction`,
      );

      // 6. Extract items using text extractor
      const rawResult = this.textExtractor.extract(pdfText, rules, source.url);

      // 7. Map through domain mapper
      const result = this.mapper.map<T>(rawResult, source);
      result.extractionTimeMs = Date.now() - pipelineStart;
      return result;
    } catch (error) {
      errors.push((error as Error).message);
      return this.emptyResult(errors, warnings, pipelineStart);
    }
  }

  /**
   * Follow a gateway page to find the actual PDF download link.
   */
  private async resolvePdfLink(gatewayUrl: string): Promise<string> {
    const response = await fetch(gatewayUrl, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(
        `Gateway page returned ${response.status}: ${response.statusText}`,
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Find the first PDF link
    const pdfLink = $('a[href$=".pdf"], a[href$=".PDF"]').first().attr("href");
    if (!pdfLink) {
      throw new Error(`No PDF link found on gateway page: ${gatewayUrl}`);
    }

    // Resolve relative URL
    const base = new URL(gatewayUrl);
    return new URL(pdfLink, base).toString();
  }

  /**
   * Build the AI prompt for text extraction rule generation.
   */
  private buildAnalysisPrompt(source: DataSourceConfig, text: string): string {
    const hintsSection = source.hints?.length
      ? "## Hints\n" + source.hints.map((h) => "- " + h).join("\n") + "\n\n"
      : "";

    return `You are a data extraction specialist. Analyze the following PDF text content and produce JSON extraction rules.

## Goal
${source.contentGoal}

## Data type
${source.dataType}

${hintsSection}## Instructions
Produce a JSON object with these fields:
- "itemDelimiter": A regex pattern that separates individual items/records in the text
- "fieldMappings": An array of field extraction rules, each with:
  - "fieldName": The domain model field name (e.g., "title", "scheduledAt", "externalId", "location")
  - "pattern": A regex pattern with capture groups to extract the value from each item block
  - "captureGroup": Which capture group contains the value (default: 1)
  - "required": Whether this field must be present (true/false)
  - "defaultValue": Optional default if pattern doesn't match
- "dataSectionStart": Optional regex to find where the actual data begins (skip headers/preamble)
- "dataSectionEnd": Optional regex to find where the data ends
- "skipLines": Number of lines to skip from the top
- "analysisNotes": Brief notes about the text structure

Required fields for "${source.dataType}":
${this.getRequiredFields(source.dataType)}

Respond with ONLY valid JSON, no markdown fences or explanation.

## PDF Text Content
${text}`;
  }

  /**
   * Get required fields for a data type.
   */
  private getRequiredFields(dataType: string): string {
    switch (dataType) {
      case "meetings":
        return "- externalId (unique identifier)\n- title (committee/meeting name)\n- scheduledAt (date and time)\n- body (e.g., 'Senate', 'Assembly')\n- location (room/address, optional)";
      case "propositions":
        return "- externalId (bill/measure ID)\n- title\n- status (optional)";
      case "representatives":
        return "- externalId\n- name\n- chamber\n- district\n- party";
      default:
        return "- externalId\n- relevant fields for " + dataType;
    }
  }

  /**
   * Parse AI response into TextExtractionRuleSet.
   *
   * Two-stage parse strategy: first try a direct `JSON.parse` on the
   * fence-stripped response (fast path, ~95% of well-formed responses).
   * On failure, fall through to {@link extractJsonObjectSlice} which
   * scans for the first balanced `{…}` block — recovers from prose
   * surrounding the JSON, trailing commentary after the closing brace,
   * and other LLM-quality artifacts that defeat plain JSON.parse.
   *
   * Real-world failure that motivated the salvage path: qwen3.5:9b
   * truncated the senate-daily-file rules at ~2802 chars with an
   * unterminated string. Direct JSON.parse throws; the salvage path
   * still recovers the leading balanced object when present.
   */
  private parseTextExtractionRules(
    llmResponse: string,
  ): TextExtractionRuleSet | null {
    const cleaned = stripCodeFences(llmResponse.trim());
    const parsed = this.tryParseJson(cleaned) ?? this.trySalvageJson(cleaned);
    if (!parsed) return null;
    if (!parsed.itemDelimiter || !parsed.fieldMappings?.length) {
      this.logger.warn("AI produced incomplete text extraction rules");
      return null;
    }
    return parsed;
  }

  private tryParseJson(text: string): TextExtractionRuleSet | null {
    try {
      return JSON.parse(text) as TextExtractionRuleSet;
    } catch {
      return null;
    }
  }

  private trySalvageJson(text: string): TextExtractionRuleSet | null {
    const candidate = extractJsonObjectSlice(text);
    if (!candidate) {
      this.logger.error(
        `Failed to parse text extraction rules: no balanced JSON object in ${text.length}-char response`,
      );
      return null;
    }
    try {
      const parsed = JSON.parse(candidate) as TextExtractionRuleSet;
      this.logger.warn(
        `Recovered text extraction rules via JSON salvage (${candidate.length} of ${text.length} chars)`,
      );
      return parsed;
    } catch (error) {
      this.logger.error(
        `Failed to parse text extraction rules even after salvage: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private emptyResult<T>(
    errors: string[],
    warnings: string[],
    startTime: number,
  ): ExtractionResult<T> {
    return {
      items: [],
      manifestVersion: 0,
      success: false,
      warnings,
      errors,
      extractionTimeMs: Date.now() - startTime,
    };
  }
}
