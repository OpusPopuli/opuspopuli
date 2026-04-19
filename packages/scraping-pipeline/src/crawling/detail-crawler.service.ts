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
  StructuredFieldConfig,
} from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";

/** Maximum detail pages to fetch per source per sync (safety limit against runaway crawling) */
const MAX_DETAIL_PAGES = 500;

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

    // Derive extraction plan from the first detail page, reuse for the rest
    let extractionPlan: Record<string, string | StructuredFieldConfig> | null =
      null;

    for (let i = 0; i < toFetch.length; i++) {
      extractionPlan = await this.enrichSingleItem(
        toFetch[i],
        extractionPlan,
        source,
        llm,
        rawResult.warnings,
      );

      // Rate limit between fetches
      if (i < toFetch.length - 1) {
        await this.delay(DETAIL_FETCH_DELAY_MS);
      }
    }

    return rawResult;
  }

  /**
   * Fetch and extract content from a single detail page.
   * Returns the (possibly updated) extraction plan for reuse on subsequent items.
   */
  private async enrichSingleItem(
    item: Record<string, unknown>,
    extractionPlan: Record<string, string | StructuredFieldConfig> | null,
    source: DataSourceConfig,
    llm: ILLMProvider,
    warnings: string[],
  ): Promise<Record<string, string | StructuredFieldConfig> | null> {
    const rawUrl = item.detailUrl as string;
    const detailUrl = DetailCrawlerService.resolveUrl(rawUrl, source.url);

    try {
      const pageContent = await this.fetchDetailContent(detailUrl);
      const isHtml = pageContent.trimStart().startsWith("<");

      extractionPlan ??= await this.resolveExtractionPlan(
        pageContent,
        isHtml,
        source,
        llm,
      );

      // If plan resolved to null (PDF text mode), handle and signal for subsequent items
      if (!extractionPlan) {
        const fields = this.getDefaultTextFields(source.dataType);
        const content = this.extractTextContent(pageContent, fields);
        this.mergeContent(item, content);
        return {};
      }

      const content = this.extractWithPlan(
        pageContent,
        isHtml,
        extractionPlan,
        source.dataType,
      );
      this.mergeContent(item, content);
    } catch (error) {
      warnings.push(
        `Detail page fetch failed for ${detailUrl}: ${(error as Error).message}`,
      );
    }

    return extractionPlan;
  }

  /**
   * Resolve extraction plan: config-declared > AI-derived > null (for text fallback).
   */
  private async resolveExtractionPlan(
    pageContent: string,
    isHtml: boolean,
    source: DataSourceConfig,
    llm: ILLMProvider,
  ): Promise<Record<string, string | StructuredFieldConfig> | null> {
    if (source.detailFields) {
      this.logger.log(
        `Using config-declared detail fields: ${Object.keys(source.detailFields).join(", ")}`,
      );
      return source.detailFields;
    }

    if (!isHtml) {
      return null; // Signal text/PDF mode
    }

    const plan = await this.deriveExtractionPlan(pageContent, source, llm);
    if (plan) {
      this.logger.log(
        `AI derived extraction plan with ${Object.keys(plan).length} fields: ${JSON.stringify(plan)}`,
      );
    }
    return plan;
  }

  /**
   * Extract content using plan (CSS selectors) or fall back to full-text extraction.
   */
  private extractWithPlan(
    pageContent: string,
    isHtml: boolean,
    plan: Record<string, string | StructuredFieldConfig>,
    dataType: string,
  ): Record<string, unknown> {
    if (Object.keys(plan).length > 0 && isHtml) {
      const content = this.extractContent(pageContent, plan);
      if (Object.keys(content).length > 0) {
        this.logger.debug(
          `Extracted fields: ${Object.keys(content).join(", ")}`,
        );
        return content;
      }
    }

    // Fall back to main content text dump
    if (isHtml) {
      return this.extractMainContentText(pageContent, dataType);
    }
    const fields = this.getDefaultTextFields(dataType);
    return this.extractTextContent(pageContent, fields);
  }

  /**
   * Extract the main text content from an HTML page as a fallback.
   */
  private extractMainContentText(
    html: string,
    dataType: string,
  ): Record<string, string> {
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, iframe, nav, footer, header").remove();
    const text = ($("main").text() || $("article").text() || $("body").text())
      .replaceAll(/\s+/g, " ")
      .trim();
    const fields = this.getDefaultTextFields(dataType);
    if (text && fields.length > 0) {
      return { [fields[0]]: text };
    }
    return {};
  }

  /**
   * Merge extracted content into an item, supporting dot-notation keys
   * (e.g., "contactInfo.offices" → item.contactInfo.offices).
   * Values can be strings or arrays (for structured field extraction).
   */
  private mergeContent(
    item: Record<string, unknown>,
    content: Record<string, unknown>,
  ): void {
    for (const [key, value] of Object.entries(content)) {
      if (value === undefined || value === null || value === "") continue;

      if (key.includes(".")) {
        const [parent, child] = key.split(".", 2);
        const existing =
          (item[parent] as Record<string, unknown> | undefined) ?? {};
        if (!existing[child]) {
          existing[child] = value;
          item[parent] = existing;
        }
      } else if (!item[key]) {
        item[key] = value;
      }
    }
  }

  /**
   * Default text fields per data type for PDF extraction fallback.
   */
  private getDefaultTextFields(dataType: string): string[] {
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
   * Fetch detail page content, handling PDF extraction if needed.
   */
  private async fetchDetailContent(detailUrl: string): Promise<string> {
    const fetchResult = await this.extraction.fetchWithRetry(detailUrl);
    let content = fetchResult.content;

    const isPdf =
      detailUrl.toLowerCase().endsWith(".pdf") || content.startsWith("%PDF");

    if (isPdf) {
      content = await this.extraction.extractPdfText(
        Buffer.from(content, "binary"),
      );
      this.logger.debug(
        `Extracted ${content.length} chars from PDF: ${detailUrl}`,
      );
    }

    return content;
  }

  /**
   * Ask the AI to identify which content fields to extract from a detail page.
   * Returns field names that map to domain model fields (fullText, bio, minutes, etc.).
   */
  /**
   * Ask the AI to extract structured content from a detail page.
   * Returns a CSS-selector-based extraction plan keyed by domain field name.
   */
  private async deriveExtractionPlan(
    html: string,
    source: DataSourceConfig,
    llm: ILLMProvider,
  ): Promise<Record<string, string | StructuredFieldConfig> | null> {
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, iframe").remove();
    const simplified = $.html() ?? "";
    const truncated =
      simplified.length > 12000
        ? simplified.slice(0, 12000) + "\n<!-- truncated -->"
        : simplified;

    const fieldGuide = this.getDetailFieldGuide(source.dataType);

    const prompt = `You are a civic data extraction specialist. Given a detail page from a government website, create a CSS-selector extraction plan.

## Source Data Type
${source.dataType}

## Content Goal
${source.contentGoal}

## Available Fields
${fieldGuide}

## HTML
${truncated}

## Instructions
Return a JSON object mapping field names to CSS selectors. Each selector should target the specific element containing that field's content.

For nested fields like contactInfo, use dot notation: "contactInfo.phone", "contactInfo.address", "contactInfo.website".

Only include fields where the page actually contains that content. Prefer specific CSS classes/IDs over generic tag selectors.

Respond with ONLY valid JSON, no explanation. Example:
{"bio": ".member-bio", "contactInfo.phone": ".phone-number", "contactInfo.website": "a.website-link"}`;

    try {
      const result = await llm.generate(prompt, {
        maxTokens: 512,
        temperature: 0.1,
      });

      let json = result.text.trim();
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const plan = JSON.parse(json) as Record<string, string>;
      if (
        typeof plan === "object" &&
        plan !== null &&
        Object.values(plan).every((v) => typeof v === "string")
      ) {
        return plan;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to derive extraction plan from detail page: ${(error as Error).message}`,
      );
    }

    return null;
  }

  /**
   * Field guide per data type to help the AI identify relevant content.
   */
  private getDetailFieldGuide(dataType: string): string {
    switch (dataType) {
      case "representatives":
        return `- bio: Biography or "about" paragraph for the representative
- contactInfo.phone: Phone number (Capitol or district office)
- contactInfo.address: Office address (Capitol or district)
- contactInfo.website: Official website URL
- contactInfo.email: Email address
- committees: Committee memberships and roles`;
      case "propositions":
        return `- fullText: Full text of the bill or measure
- summary: Brief description or summary`;
      case "meetings":
        return `- minutes: Meeting minutes or notes
- agendaItems: Agenda topics`;
      default:
        return `- fullText: Main content of the page`;
    }
  }

  /**
   * Extract structured content from a detail page using CSS selectors.
   * Supports both simple string selectors and StructuredFieldConfig for arrays.
   */
  private extractContent(
    html: string,
    plan: Record<string, string | StructuredFieldConfig>,
  ): Record<string, unknown> {
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, iframe").remove();

    const result: Record<string, unknown> = {};

    for (const [field, config] of Object.entries(plan)) {
      try {
        if (typeof config === "object" && config.selector) {
          // Structured array extraction
          result[field] = this.extractStructuredField($, config);
        } else if (typeof config === "string") {
          const value = this.extractSimpleField($, field, config);
          if (value) result[field] = value;
        }
      } catch {
        // Skip fields with invalid selectors
      }
    }

    return result;
  }

  /**
   * Extract a single text or attribute value from a CSS selector.
   */
  private extractSimpleField(
    $: cheerio.CheerioAPI,
    field: string,
    rawSelector: string,
  ): string | undefined {
    const [selector, attrSpec] = rawSelector.split("|attr:");
    const el = $(selector);
    if (el.length === 0) return undefined;

    if (attrSpec) {
      return el.first().attr(attrSpec);
    }
    if (field.includes("website") || field.includes("url")) {
      return el.first().attr("href") ?? el.first().text().trim();
    }
    return el.first().text().replaceAll(/\s+/g, " ").trim() || undefined;
  }

  /**
   * Extract an array of structured objects from repeating HTML sections.
   */
  private extractStructuredField(
    $: cheerio.CheerioAPI,
    config: StructuredFieldConfig,
  ): Record<string, string>[] {
    const items: Record<string, string>[] = [];

    $(config.selector).each((_i, el) => {
      const item: Record<string, string> = {};
      for (const [childField, childSelector] of Object.entries(
        config.children,
      )) {
        const [sel, attrSpec] = childSelector.split("|attr:");
        const child = $(el).find(sel);
        if (child.length === 0) continue;

        const value = attrSpec
          ? child.first().attr(attrSpec)
          : child.first().text().replaceAll(/\s+/g, " ").trim();

        if (value) item[childField] = value;
      }
      if (Object.keys(item).length > 0) items.push(item);
    });

    return items;
  }

  /**
   * Extract content from plain text (PDF).
   * Assigns the full text to the first requested field.
   */
  private extractTextContent(
    text: string,
    fields: string[],
  ): Record<string, string> {
    const cleaned = text.replaceAll(/\s+/g, " ").trim();
    const result: Record<string, string> = {};
    if (cleaned && fields.length > 0) {
      result[fields[0]] = cleaned;
    }
    return result;
  }

  /**
   * Resolve a relative URL against the source's base URL.
   * If the URL is already absolute, returns it unchanged.
   */
  static resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
