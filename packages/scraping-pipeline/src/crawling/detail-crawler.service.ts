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
import type { ArchiveContext } from "@opuspopuli/extraction-provider";
import * as cheerio from "cheerio";
import type {
  DataSourceConfig,
  RawExtractionResult,
  ILLMProvider,
  SelectorFailure,
  StructuredFieldConfig,
} from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { extractStructuredArray } from "../extraction/structured-extractor.js";
import { extractAgSummary } from "./ag-summary.js";

/** Maximum detail pages to fetch per source per sync (safety limit against runaway crawling) */
const MAX_DETAIL_PAGES = 500;

/** Delay between detail page fetches in milliseconds */
const DETAIL_FETCH_DELAY_MS = 500;

/**
 * A detail page's text and the archived fetch it came from (#1306).
 *
 * Returned together because they are separated immediately afterwards — the
 * text is merged into the item's fields, and only this id still says which
 * bytes it was extracted from.
 */
interface DetailContent {
  content: string;
  /** Absent when archiving was not requested, or the store declined the body */
  sourceVersionId?: string;
}

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
  /**
   * Second enrichment pass: the Attorney General's title-and-summary PDF
   * (opuspopuli#1219).
   *
   * Separate from `enrichItems` because it is a DIFFERENT document with a
   * different job. `detailUrl` is the proponent's submission and feeds
   * `fullText`; `summaryUrl` is the AG's circulating text and feeds `summary`,
   * which is what the corpus embeds and what a petition scan photographs.
   * Conflating them is how `summary` came to hold the title echoed back.
   *
   * Every failure is non-fatal. A missing or unreadable summary leaves the
   * field absent, which is honest — the previous behaviour wrote the title
   * back into it, which looked like data and silently degraded retrieval.
   */
  async enrichSummaries(
    rawResult: RawExtractionResult,
    source: DataSourceConfig,
    archive?: ArchiveContext,
  ): Promise<RawExtractionResult> {
    const items = rawResult.items.filter(
      (item) => typeof item.summaryUrl === "string" && item.summaryUrl,
    );
    if (items.length === 0) return rawResult;

    this.logger.log(
      `Fetching ${items.length} Attorney General title-and-summary PDF(s)`,
    );

    let written = 0;
    for (const item of items.slice(0, MAX_DETAIL_PAGES)) {
      const url = DetailCrawlerService.resolveUrl(
        item.summaryUrl as string,
        source.url,
      );
      try {
        // Deliberately drops the archived id: this is the AG title-and-summary
        // PDF, which feeds `summary`, where the detail page feeds `fullText`
        // (#1219). Claims index into `fullText`, so stamping the row with this
        // fetch would point every citation at the wrong document.
        const { text, reason } = extractAgSummary(
          (await this.fetchDetailContent(url, archive)).content,
        );
        if (text) {
          item.summary = text;
          written += 1;
        } else {
          rawResult.warnings.push(
            `AG summary rejected for ${String(item.externalId)} (${reason}): ${url}`,
          );
        }
      } catch (error) {
        rawResult.warnings.push(
          `AG summary fetch failed for ${String(item.externalId)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `Wrote ${written} of ${items.length} Attorney General summaries`,
    );
    return rawResult;
  }

  async enrichItems(
    rawResult: RawExtractionResult,
    source: DataSourceConfig,
    llm: ILLMProvider,
    archive?: ArchiveContext,
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
    const detailFailures = new Map<string, SelectorFailure>();

    for (let i = 0; i < toFetch.length; i++) {
      extractionPlan = await this.enrichSingleItem(
        toFetch[i],
        extractionPlan,
        source,
        llm,
        rawResult.warnings,
        detailFailures,
        archive,
      );

      // Rate limit between fetches
      if (i < toFetch.length - 1) {
        await this.delay(DETAIL_FETCH_DELAY_MS);
      }
    }

    if (detailFailures.size > 0) {
      const failures = [...detailFailures.values()];
      rawResult.selectorFailures = [
        ...(rawResult.selectorFailures ?? []),
        ...failures,
      ];
      rawResult.warnings.push(...failures.map((f) => f.message));
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
    failures?: Map<string, SelectorFailure>,
    archive?: ArchiveContext,
  ): Promise<Record<string, string | StructuredFieldConfig> | null> {
    const rawUrl = item.detailUrl as string;
    const detailUrl = DetailCrawlerService.resolveUrl(rawUrl, source.url);

    try {
      const { content: pageContent, sourceVersionId } =
        await this.fetchDetailContent(detailUrl, archive);
      // Stamped per item, not per run. `stampProvenance` gives every item in
      // a result the same execution id, which is right for a run — but each
      // item's text came from ITS OWN detail fetch, and a shared reference
      // here would point most rows at some other page's bytes (#1306).
      if (sourceVersionId) item.sourceVersionId = sourceVersionId;
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
        failures,
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
    failures?: Map<string, SelectorFailure>,
  ): Record<string, unknown> {
    if (Object.keys(plan).length > 0 && isHtml) {
      const content = this.extractContent(pageContent, plan, failures);
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
   *
   * URLs ending in .pdf are fetched binary-safe via fetchPdfText; the
   * old pattern of `fetchWithRetry → Buffer.from(content, "binary")`
   * silently mangled real PDF bytes (the response.text() UTF-8 decode
   * is irreversible for non-ASCII bytes, leaving the parser to fail
   * with "Invalid Root reference"). For pages that don't end in .pdf
   * but turn out to be PDF responses, we re-fetch as bytes since the
   * first fetch's content is already corrupted.
   */
  private async fetchDetailContent(
    detailUrl: string,
    archive?: ArchiveContext,
  ): Promise<DetailContent> {
    // Detail pages and their PDFs are the artifacts claims actually cite —
    // `fullText` comes from here — so these are the fetches worth archiving
    // (#1276). List and discovery pages deliberately are not.
    const options = archive ? { archive } : {};

    if (detailUrl.toLowerCase().endsWith(".pdf")) {
      const pdf = await this.extraction.fetchPdfText(detailUrl, options);
      this.logger.debug(
        `Extracted ${pdf.text.length} chars from PDF: ${detailUrl}`,
      );
      return { content: pdf.text, sourceVersionId: pdf.sourceVersionId };
    }

    const fetchResult = await this.extraction.fetchWithRetry(
      detailUrl,
      options,
    );
    if (fetchResult.content.startsWith("%PDF")) {
      // URL didn't advertise .pdf but the response body is one — refetch
      // as bytes. The text-mode body is already corrupted; we can't
      // recover it via Buffer.from(content, "binary").
      const pdf = await this.extraction.fetchPdfText(detailUrl, options);
      this.logger.debug(
        `Extracted ${pdf.text.length} chars from PDF: ${detailUrl} (content-sniffed)`,
      );
      // The archived artifact is the one from the REFETCH, not the mangled
      // first read — that is the byte sequence this text was extracted from.
      return { content: pdf.text, sourceVersionId: pdf.sourceVersionId };
    }

    return {
      content: fetchResult.content,
      sourceVersionId: fetchResult.sourceVersionId,
    };
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
    failures?: Map<string, SelectorFailure>,
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
      } catch (error) {
        // Invalid selector (e.g. Cheerio parse failure). Previously a bare
        // catch {} — detailFields drift produced no diagnostic at all
        // (#966 W1). Keyed by field so the same broken selector isn't
        // recorded once per enriched item.
        const selector =
          typeof config === "string" ? config : (config.selector ?? "");
        failures?.set(field, {
          kind: "detail_field_error",
          field,
          selector,
          message:
            'Detail field "' +
            field +
            '" selector failed: "' +
            selector +
            '" — ' +
            (error as Error).message,
        });
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
   * Delegates to the shared extractStructuredArray utility, using the document
   * root as the scope (detail pages are extracted whole-document).
   */
  private extractStructuredField(
    $: cheerio.CheerioAPI,
    config: StructuredFieldConfig,
  ): Record<string, string>[] {
    return extractStructuredArray(
      $,
      $.root(),
      config.selector,
      config.children,
    );
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
