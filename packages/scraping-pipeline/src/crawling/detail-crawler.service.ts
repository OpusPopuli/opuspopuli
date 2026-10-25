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
import {
  envInt,
  htmlToReadableText,
  mapWithConcurrency,
} from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { extractStructuredArray } from "../extraction/structured-extractor.js";
import { extractAgSummary } from "./ag-summary.js";

/** Maximum detail pages to fetch per source per sync (safety limit against runaway crawling) */
const MAX_DETAIL_PAGES = 500;

/**
 * Detail pages fetched at once (the fetch lane, propositions Phase B). The
 * per-host token bucket (S1) — not a pause — keeps each site at its
 * configured rate: concurrency lets two hosts' budgets overlap and keeps the
 * pipe full while one page's PDF is parsed. `DETAIL_FETCH_CONCURRENCY`
 * overrides it.
 */
function detailFetchConcurrency(): number {
  return envInt("DETAIL_FETCH_CONCURRENCY", 4);
}

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

/**
 * Readable text for one element, routed through the shared HTML-to-text
 * converter rather than cheerio's `.text()`.
 *
 * `.text()` concatenates descendant text nodes with NO separator, so block
 * boundaries vanish and adjacent words fuse: a Senate page's heading and
 * first paragraph came out as "SenatorJesse", and a surname running into the
 * next sentence as "Grove.The". Measured on 20 scraped Senate bios, 7 carried
 * at least one fused pair.
 *
 * Exported, and free of `this`, so the fusing is directly testable — it was a
 * private method and the regression had no guard, which meant reverting to
 * `.text()` was caught by nothing.
 *
 * Falls back to `.text()` when the element has no inner HTML, the ordinary
 * case for a leaf like `<span>22</span>`.
 *
 * @param el - Anything cheerio-shaped enough to yield html and text
 * @returns Whitespace-collapsed readable text
 */
export function elementText(el: {
  html(): string | null;
  text(): string;
}): string {
  const inner = el.html();
  const text = inner ? htmlToReadableText(inner) : el.text();
  return text.replaceAll(/\s+/g, " ").trim();
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
    await mapWithConcurrency(
      items.slice(0, MAX_DETAIL_PAGES),
      detailFetchConcurrency(),
      async (item) => {
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
      },
    );

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

    // Derive the extraction plan from the first detail page that yields one,
    // serially — an LLM-derived plan would otherwise be derived once per
    // concurrent item — then reuse it for the rest, fetched concurrently.
    let extractionPlan: Record<string, string | StructuredFieldConfig> | null =
      null;
    const detailFailures = new Map<string, SelectorFailure>();
    const enrich = (item: Record<string, unknown>) =>
      this.enrichSingleItem(
        item,
        extractionPlan,
        source,
        llm,
        rawResult.warnings,
        detailFailures,
        archive,
      );

    let settled = 0;
    while (settled < toFetch.length && extractionPlan === null) {
      extractionPlan = await enrich(toFetch[settled++]);
    }
    await mapWithConcurrency(
      toFetch.slice(settled),
      detailFetchConcurrency(),
      enrich,
    );

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

    // Deliberately OUTSIDE the try above: a primary fetch that failed does not
    // imply the secondary will. The base URL may already have come from the
    // listing page, and a biography we can still fetch is worth having.
    await this.enrichFromSecondaryDetail(
      item,
      source,
      warnings,
      failures,
      archive,
    );

    return extractionPlan;
  }

  /**
   * Fetch one secondary page per item and fill fields the primary left empty
   * (#1383).
   *
   * Exists because the page carrying a representative's biography is not the
   * page carrying their committees: the Assembly roster detail page holds
   * committees, offices and counties, while the biography lives on the
   * member's own caucus site. Repointing `detailUrl` would trade a measured
   * 90% committee recall for an unmeasured bio.
   *
   * Three properties this relies on, all deliberate:
   *
   * - **Absent-only merge.** `mergeContent` already skips keys the item holds,
   *   so a looser secondary selector cannot clobber authoritative primary
   *   data. Reused rather than reimplemented so the two paths cannot drift.
   * - **Isolated failure.** A 404, a timeout, or a selector matching nothing
   *   warns and leaves the item exactly as the primary left it. A bio we could
   *   not fetch must not cost us committees we did.
   * - **Provenance is NOT repointed.** `fetchDetailContent` archives this page
   *   and returns its `sourceVersionId`, which is discarded on purpose:
   *   `item.sourceVersionId` describes the primary page (#1306, stamped per
   *   item), and committees/offices come from there. One id cannot honestly
   *   describe two pages, and claiming the biography came from the roster page
   *   would be worse than claiming nothing. The bytes are archived and
   *   identifiable by URL; per-field provenance is filed separately.
   */
  private async enrichFromSecondaryDetail(
    item: Record<string, unknown>,
    source: DataSourceConfig,
    warnings: string[],
    failures?: Map<string, SelectorFailure>,
    archive?: ArchiveContext,
  ): Promise<void> {
    const config = source.secondaryDetail;
    if (!config) return;

    const base = DetailCrawlerService.readPath(item, config.urlFrom);
    // Absence is normal, not an error: a representative with no website simply
    // has no secondary page. Warning here would fire for every such row and
    // train the operator to ignore the channel.
    if (typeof base !== "string" || base.trim() === "") return;

    const url = DetailCrawlerService.joinUrl(base.trim(), config.urlSuffix);

    // The politeness budget is the per-host token bucket (S1), which every
    // fetch passes through — a secondary hop to the same site shares its
    // bucket, so it cannot double the rate against it.
    try {
      const { content } = await this.fetchDetailContent(url, archive);
      const isHtml = content.trimStart().startsWith("<");
      if (!isHtml) {
        warnings.push(`Secondary detail page was not HTML: ${url}`);
        return;
      }

      // Selector-only on purpose — NOT extractWithPlan, which falls back to a
      // main-content text dump when the plan matches nothing. For
      // `representatives` the default text field is `bio`, so that fallback
      // would quietly store a page's nav and footer AS the biography and mark
      // it `bioSource: 'scraped'`. That is how #658's "junk bios" happened.
      // Here a selector miss must produce nothing and say so.
      // Empty values count as a miss, not a hit. Demonstrated on
      // `a04.asmdc.org/biography`, where the looser `.field--name-body`
      // selector matches three elements and the FIRST is empty — a
      // keys-only check would see `{ bio: "" }`, warn about nothing, and
      // leave the field silently unset.
      const extracted = Object.fromEntries(
        Object.entries(
          this.extractContent(content, config.fields, failures),
        ).filter(
          ([, v]) => v !== undefined && v !== null && String(v).trim() !== "",
        ),
      );
      if (Object.keys(extracted).length === 0) {
        warnings.push(
          `Secondary detail selectors matched nothing on ${url} ` +
            `(${Object.keys(config.fields).join(", ")})`,
        );
        return;
      }

      this.mergeContent(item, extracted);
    } catch (error) {
      warnings.push(
        `Secondary detail fetch failed for ${url}: ${(error as Error).message}`,
      );
    }
  }

  /** Read a dot-notated path off an item, e.g. `contactInfo.website`. */
  private static readPath(
    item: Record<string, unknown>,
    path: string,
  ): unknown {
    return path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object"
            ? (acc as Record<string, unknown>)[key]
            : undefined,
        item,
      );
  }

  /**
   * Join a base URL and an optional path segment with exactly one `/`.
   *
   * Both forms occur in the live data — one rep's stored website lacks the
   * trailing slash every other one has — so this cannot assume either.
   */
  private static joinUrl(base: string, suffix?: string): string {
    if (!suffix) return base;
    return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
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
    // Same boundary problem as `elementText` — `.text()` glues a heading to
    // the paragraph after it. The chrome removal above is kept because it
    // operates on the parsed DOM, which is stricter than the regex pass.
    const text =
      elementText($("main").first()) ||
      elementText($("article").first()) ||
      elementText($("body").first());
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
  /**
   * Text of an element, with whitespace at tag boundaries (#1382 follow-up).
   *
   * cheerio's `.text()` concatenates descendant text nodes with NOTHING
   * between them, so a heading followed by a paragraph comes back as
   * "SenatorJesse Arreguin" and a sentence boundary as "Elk Grove.The only
   * woman". Measured on the first scraped Senate bios: 7 of 20 carried glued
   * words. That corrupts sentence splitting, claim matching and embeddings
   * silently — nothing downstream can tell "Grove.The" from a typo on the
   * page.
   *
   * Routed through `htmlToReadableText` rather than a local fix, for three
   * reasons: it already inserts separators at tag boundaries, it already
   * strips nested script/style/nav/header/footer chrome, and it is the SAME
   * function the text-dump fallback and the eval harness use — so selector
   * extraction and full-text extraction can no longer disagree about what the
   * page says.
   *
   * Falls back to `.text()` when the element has no inner HTML, which is the
   * ordinary case for a leaf like `<span>22</span>`.
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
      return el.first().attr("href") ?? elementText(el.first());
    }
    return elementText(el.first()) || undefined;
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
}
