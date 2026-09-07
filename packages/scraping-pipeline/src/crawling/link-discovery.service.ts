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

    const maxPages = config.maxLeafPages ?? DEFAULT_MAX_LEAF_PAGES;
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
      let html: string;
      try {
        html = (await this.extraction.fetchWithRetry(pageUrl)).content;
      } catch (error) {
        warnings.push(
          `${stepLabel}: fetch failed for ${pageUrl}: ${(error as Error).message}`,
        );
        continue;
      }

      const matches = this.matchAnchors(
        html,
        pageUrl,
        seedUrl,
        textRegex,
        hrefRegex,
      );
      if (matches.length === 0) {
        // Per-page zero is expected mid-cycle (e.g. an election page whose
        // measures list isn't posted yet) — only all-pages-zero is fatal.
        warnings.push(`${stepLabel}: no matching links on ${pageUrl}`);
        continue;
      }

      const take = step.select === "all" ? matches : matches.slice(0, 1);
      for (const url of take) {
        if (!seen.has(url)) {
          seen.add(url);
          selected.push(url);
        }
      }
    }

    return selected;
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
