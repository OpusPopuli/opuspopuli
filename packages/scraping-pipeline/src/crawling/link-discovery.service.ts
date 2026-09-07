/**
 * Link Discovery Service
 *
 * Deterministic hub navigation for html_scrape sources whose seed URL is
 * a multi-level hub rather than the page holding the data (#1164). Given
 * an ordered list of steps (regex on anchor text, optionally on the
 * resolved href), it walks: seed page → step-1 matches → step-2 matches
 * applied to each of those pages → … and returns the pages selected by
 * the final step as extraction targets.
 *
 * Same rationale as BillDiscoveryConfig: blind BFS (`crawlDepth`) wastes
 * `crawlMaxPages` on nav links and does not reliably reach a specific
 * leaf, while the hub → leaf link *text* is stable across election
 * cycles even though the leaf URLs change every cycle.
 *
 * Key behaviors:
 * - No LLM involved — pure fetch + Cheerio anchor matching.
 * - Scoped to the seed's host, HTTPS only (mirrors crawlCivicsUrls).
 * - A step matching zero links across every page it was applied to is a
 *   hard error, so a county-site restructure fails loudly instead of
 *   yielding a silent empty sync. Zero matches on ONE of several pages
 *   (e.g. an election page whose measures list isn't posted yet) is
 *   only a warning.
 * - Every level is capped at `maxLeafPages` (default 5) to bound fetch
 *   count and downstream per-leaf LLM spend.
 */

import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import type { DataSourceConfig, LinkDiscoveryStep } from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { safeRegex } from "../extraction/safe-regex.js";

/** Default cap on pages selected per navigation level. */
const DEFAULT_MAX_LEAF_PAGES = 5;

export interface LinkDiscoveryResult {
  /** Absolute URLs of the pages selected by the final step. Empty on error. */
  leafUrls: string[];
  /** Non-fatal notes (per-page zero matches, fetch failures, cap trims). */
  warnings: string[];
  /** Fatal errors — a step with zero matches overall, or a bad config. */
  errors: string[];
}

@Injectable()
export class LinkDiscoveryService {
  private readonly logger = new Logger(LinkDiscoveryService.name);

  constructor(private readonly extraction: ExtractionProvider) {}

  /**
   * Resolve the extraction-target URLs for a source with `linkDiscovery`.
   */
  async discover(source: DataSourceConfig): Promise<LinkDiscoveryResult> {
    const warnings: string[] = [];
    const config = source.linkDiscovery;
    if (!config?.steps?.length) {
      return {
        leafUrls: [],
        warnings,
        errors: ["linkDiscovery requires at least one step"],
      };
    }

    let seedUrl: URL;
    try {
      seedUrl = new URL(source.url);
    } catch {
      return {
        leafUrls: [],
        warnings,
        errors: [`linkDiscovery seed URL is not a valid URL: ${source.url}`],
      };
    }
    if (seedUrl.protocol !== "https:") {
      return {
        leafUrls: [],
        warnings,
        errors: [`linkDiscovery seed must be HTTPS: ${source.url}`],
      };
    }

    // Clamp rather than trust: `maxLeafPages: 0` would slice every level to
    // an empty set and return "no leaves, no errors" — a silent empty sync,
    // the exact failure #1164 exists to eliminate.
    const configured = config.maxLeafPages ?? DEFAULT_MAX_LEAF_PAGES;
    const maxPages =
      Number.isFinite(configured) && configured >= 1
        ? Math.floor(configured)
        : DEFAULT_MAX_LEAF_PAGES;
    if (maxPages !== configured) {
      warnings.push(
        `linkDiscovery maxLeafPages=${configured} is invalid; using ${maxPages}`,
      );
    }
    let currentPages = [seedUrl.toString()];

    for (const [index, step] of config.steps.entries()) {
      const stepLabel = `linkDiscovery step ${index + 1} ("${step.textPattern}")`;
      const result = await this.applyStep(
        step,
        stepLabel,
        currentPages,
        seedUrl,
        warnings,
      );
      if (result === undefined) {
        return {
          leafUrls: [],
          warnings,
          errors: [`${stepLabel} has an invalid regex pattern`],
        };
      }
      if (result.length === 0) {
        // The loud staleness alarm (#1164): the site restructured (or the
        // pattern rotted) — fail the source rather than sync 0 rows silently.
        return {
          leafUrls: [],
          warnings,
          errors: [
            `${stepLabel} matched no links on any of ${currentPages.length} page(s) — ` +
              `the site structure or link text likely changed; update the source's linkDiscovery steps`,
          ],
        };
      }
      if (result.length > maxPages) {
        warnings.push(
          `${stepLabel} matched ${result.length} pages; capped to maxLeafPages=${maxPages}`,
        );
      }
      currentPages = result.slice(0, maxPages);
    }

    this.logger.log(
      `Link discovery resolved ${currentPages.length} leaf page(s) from ${source.url}`,
    );
    return { leafUrls: currentPages, warnings, errors: [] };
  }

  /**
   * Apply one step to every current page, returning the deduped absolute
   * URLs of matching anchors in document order. Returns undefined when a
   * pattern doesn't compile (config error, fail the source).
   */
  private async applyStep(
    step: LinkDiscoveryStep,
    stepLabel: string,
    pages: string[],
    seedUrl: URL,
    warnings: string[],
  ): Promise<string[] | undefined> {
    const textRegex = safeRegex(step.textPattern, "i");
    if (!textRegex) return undefined;
    const hrefRegex = step.hrefPattern
      ? (safeRegex(step.hrefPattern, "i") ?? null)
      : null;
    if (step.hrefPattern && !hrefRegex) return undefined;

    const selected: string[] = [];
    const seen = new Set<string>();

    for (const pageUrl of pages) {
      const matches = await this.collectFromPage(
        pageUrl,
        stepLabel,
        seedUrl,
        textRegex,
        hrefRegex,
        warnings,
      );
      const take = step.select === "all" ? matches : matches.slice(0, 1);
      for (const url of take) {
        if (seen.has(url)) continue;
        seen.add(url);
        selected.push(url);
      }
    }

    return selected;
  }

  /**
   * Fetch one page and return the in-scope anchors matching this step.
   * Fetch failures and per-page zero-matches degrade to warnings — mid-cycle
   * an election page legitimately has no measures list yet, and only
   * all-pages-zero is treated as fatal by the caller.
   */
  private async collectFromPage(
    pageUrl: string,
    stepLabel: string,
    seedUrl: URL,
    textRegex: RegExp,
    hrefRegex: RegExp | null,
    warnings: string[],
  ): Promise<string[]> {
    let html: string;
    let effectiveUrl = pageUrl;
    try {
      const fetched = await this.extraction.fetchWithRetry(pageUrl);
      html = fetched.content;
      // The fetcher follows redirects, so the in-scope check on the anchor
      // does not bind where the request actually landed: an open redirect on
      // the seed host would take us off-host (or off-HTTPS) with the response
      // still feeding anchor matching. Re-check the landing URL, and use it
      // as the base for relative hrefs.
      //
      // Scope note: this covers the pages walked HERE. The leaf fetch happens
      // later in executeHtmlScrape, which shares the platform-wide fetcher and
      // does not re-check its own landing URL — so a redirected leaf still
      // reaches extraction. Tightening that belongs with the fetcher, since
      // every source type has the same gap.
      if (fetched.finalUrl && fetched.finalUrl !== pageUrl) {
        if (!this.isInScope(fetched.finalUrl, seedUrl)) {
          warnings.push(
            `${stepLabel}: ${pageUrl} redirected out of scope to ${fetched.finalUrl} — not followed`,
          );
          return [];
        }
        effectiveUrl = fetched.finalUrl;
      }
    } catch (error) {
      warnings.push(
        `${stepLabel}: fetch failed for ${pageUrl}: ${(error as Error).message}`,
      );
      return [];
    }

    const matches = this.matchAnchors(
      html,
      effectiveUrl,
      seedUrl,
      textRegex,
      hrefRegex,
    );
    if (matches.length === 0) {
      warnings.push(`${stepLabel}: no matching links on ${pageUrl}`);
    }
    return matches;
  }

  /**
   * Extract anchors matching the step's patterns, resolved to absolute
   * URLs, restricted to the seed's host over HTTPS.
   */
  private matchAnchors(
    html: string,
    pageUrl: string,
    seedUrl: URL,
    textRegex: RegExp,
    hrefRegex: RegExp | null,
  ): string[] {
    const $ = cheerio.load(html);
    const matches: string[] = [];

    $("a[href]").each((_, el) => {
      const anchor = $(el);
      const text = anchor.text().replaceAll(/\s+/g, " ").trim();
      if (!text || !textRegex.test(text)) return;

      const resolved = this.resolveInScope(
        anchor.attr("href") ?? "",
        pageUrl,
        seedUrl,
      );
      if (!resolved) return;
      if (hrefRegex && !hrefRegex.test(resolved)) return;
      matches.push(resolved);
    });

    return matches;
  }

  /**
   * Resolve an href against its page and enforce the navigation scope:
   * same host as the seed, HTTPS only. Returns the canonical absolute
   * URL (no fragment) or null when out of scope / malformed.
   */
  /** Same host as the seed, HTTPS only — the navigation scope in one place. */
  private isInScope(url: string, seedUrl: URL): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.host === seedUrl.host;
    } catch {
      return false;
    }
  }

  private resolveInScope(
    href: string,
    pageUrl: string,
    seedUrl: URL,
  ): string | null {
    if (
      !href ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#")
    ) {
      return null;
    }
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.protocol !== "https:" || resolved.host !== seedUrl.host) {
        return null;
      }
      resolved.hash = "";
      return resolved.toString();
    } catch {
      return null;
    }
  }
}
