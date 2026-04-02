/**
 * Detail Crawler Service
 *
 * Enriches extracted listing items by fetching their detail pages
 * and extracting rich content (full text, bios, minutes, etc.).
 *
 * Flow:
 * 1. Filter items that have a `detailUrl` field
 * 2. Fetch the first detail page to derive extraction rules (AI, one-time)
 * 3. Apply the same rules to all remaining detail pages (deterministic)
 * 4. Merge extracted content back into the listing items
 *
 * Key behaviors:
 * - Soft failures: if a detail page fetch fails, the listing item is kept as-is
 * - Rate limited: uses ExtractionProvider (already rate-limited + cached)
 * - AI analysis once: all detail pages for a source share the same structure
 */

import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import type {
  DataSourceConfig,
  RawExtractionResult,
  ILLMProvider,
} from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";

/** Maximum detail pages to fetch per sync run (safety limit) */
const MAX_DETAIL_PAGES = 50;

/** Delay between detail page fetches in milliseconds */
const DETAIL_FETCH_DELAY_MS = 500;

@Injectable()
export class DetailCrawlerService {
  private readonly logger = new Logger(DetailCrawlerService.name);

  constructor(private readonly extraction: ExtractionProvider) {}

  /**
   * Enrich extracted items by fetching their detail pages.
   * Items without a `detailUrl` field pass through unchanged.
   *
   * @param rawResult - Raw extraction result from the listing page
   * @param source - Data source configuration (for hints, content goal)
   * @param llm - LLM provider for AI content extraction
   * @returns Enriched raw result with detail page content merged into items
   */
  async enrichItems(
    rawResult: RawExtractionResult,
    source: DataSourceConfig,
    llm: ILLMProvider,
  ): Promise<RawExtractionResult> {
    const itemsWithDetail = rawResult.items.filter(
      (item) => item.detailUrl && typeof item.detailUrl === "string",
    );

    if (itemsWithDetail.length === 0) {
      return rawResult;
    }

    this.logger.log(
      `Enriching ${itemsWithDetail.length} items with detail page content from ${source.url}`,
    );

    // Limit to prevent excessive fetching
    const toFetch = itemsWithDetail.slice(0, MAX_DETAIL_PAGES);
    if (itemsWithDetail.length > MAX_DETAIL_PAGES) {
      rawResult.warnings.push(
        `Only enriching first ${MAX_DETAIL_PAGES} of ${itemsWithDetail.length} items with detail pages`,
      );
    }

    // Derive content extraction rules from the first detail page
    let contentFields: string[] | null = null;

    for (const item of toFetch) {
      const detailUrl = item.detailUrl as string;

      try {
        const fetchResult = await this.extraction.fetchWithRetry(detailUrl);
        const html = fetchResult.content;

        // On first successful fetch, ask AI what content to extract
        if (!contentFields) {
          contentFields = await this.deriveContentFields(html, source, llm);
          this.logger.log(
            `AI derived ${contentFields.length} content fields from detail page`,
          );
        }

        // Extract content from the detail page
        const content = this.extractContent(html, contentFields);

        // Merge extracted content into the listing item
        for (const [key, value] of Object.entries(content)) {
          if (value && !item[key]) {
            item[key] = value;
          }
        }
      } catch (error) {
        // Soft failure — keep listing item, log warning
        rawResult.warnings.push(
          `Detail page fetch failed for ${detailUrl}: ${(error as Error).message}`,
        );
      }

      // Rate limit between fetches
      if (toFetch.indexOf(item) < toFetch.length - 1) {
        await this.delay(DETAIL_FETCH_DELAY_MS);
      }
    }

    return rawResult;
  }

  /**
   * Ask the AI to identify which content fields to extract from a detail page.
   * Returns field names that map to domain model fields (fullText, bio, minutes, etc.).
   */
  private async deriveContentFields(
    html: string,
    source: DataSourceConfig,
    llm: ILLMProvider,
  ): Promise<string[]> {
    // Simplify HTML for the AI
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, iframe, nav, footer, header").remove();
    const simplified = $.text().replaceAll(/\s+/g, " ").trim();
    const truncated =
      simplified.length > 8000
        ? simplified.slice(0, 8000) + "\n[... truncated ...]"
        : simplified;

    const prompt = `You are a civic data extraction specialist. Given a detail page from a government website, identify what content fields can be extracted.

## Source Data Type
${source.dataType}

## Content Goal
${source.contentGoal}

## Page Text (simplified)
${truncated}

## Instructions
Return a JSON array of field names to extract. Use these domain model field names:
- For propositions: "fullText" (full bill/measure text), "summary" (brief description)
- For meetings: "minutes" (meeting minutes/notes), "agendaItems" (list of agenda topics)
- For representatives: "bio" (biography), "committees" (committee assignments)

Only include fields where the page actually contains that content.
Respond with ONLY a JSON array, no explanation. Example: ["fullText", "summary"]`;

    try {
      const result = await llm.generate(prompt, {
        maxTokens: 256,
        temperature: 0.1,
      });

      let json = result.text.trim();
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const fields = JSON.parse(json) as string[];
      if (Array.isArray(fields) && fields.every((f) => typeof f === "string")) {
        return fields;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to derive content fields from detail page: ${(error as Error).message}`,
      );
    }

    // Fallback: extract common fields based on data type
    return this.defaultContentFields(source.dataType);
  }

  /**
   * Default content fields per data type when AI derivation fails.
   */
  private defaultContentFields(dataType: string): string[] {
    switch (dataType) {
      case "propositions":
        return ["fullText"];
      case "meetings":
        return ["minutes"];
      case "representatives":
        return ["bio"];
      default:
        return ["fullText"];
    }
  }

  /**
   * Extract content from a detail page HTML.
   * Uses a simple approach: extract the main text content from the page body.
   */
  private extractContent(
    html: string,
    fields: string[],
  ): Record<string, string> {
    const $ = cheerio.load(html);

    // Remove non-content elements
    $("script, style, noscript, svg, iframe, nav, footer, header").remove();

    // Try to find the main content area
    const mainContent =
      $("main").text() ||
      $("article").text() ||
      $('[role="main"]').text() ||
      $(".content, .main-content, #content, #main-content").text() ||
      $("body").text();

    const cleanedText = mainContent.replaceAll(/\s+/g, " ").trim();

    // Assign the content to the first requested field
    const result: Record<string, string> = {};
    if (cleanedText && fields.length > 0) {
      result[fields[0]] = cleanedText;
    }

    return result;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
