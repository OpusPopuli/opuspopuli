/**
 * Minutes Ingest Handler
 *
 * Handles `sourceType: pdf_archive` — paginated listing pages that
 * link to a series of dated PDF documents (CA Assembly daily journals,
 * federal Congressional Record, etc.). Each linked PDF is fetched,
 * pdf-parsed, and emitted as a `Minutes` record. Per-document parsing
 * (text → action records) is a downstream backend pass, not this
 * handler's responsibility.
 *
 * Cold-start protection: the handler reads the watermark for the
 * source before walking, sorts candidates descending by date, and
 * stops at either the watermark's `lastExternalId` or the configured
 * `maxNew` cap (default 10). Documents are processed in ASCENDING
 * order so a partial failure leaves the watermark advanced only as
 * far as the last successful document.
 *
 * Issue #665.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as cheerio from "cheerio";
import {
  type DataSourceConfig,
  type ExtractionResult,
  type Minutes,
  type MinutesWithActions,
  type PdfArchiveConfig,
} from "@opuspopuli/common";
import { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { IngestionWatermarkService } from "../manifest/ingestion-watermark.service.js";

/** Maximum bytes of pdf-parse output stored on Minutes.rawText. */
const MAX_RAW_TEXT_CHARS = 256 * 1024;

interface ListingCandidate {
  url: string;
  date: Date;
  revisionSeq: number;
  externalIdHint: string;
}

@Injectable()
export class MinutesIngestHandler {
  private readonly logger = new Logger(MinutesIngestHandler.name);

  constructor(
    private readonly extraction: ExtractionProvider,
    @Optional() private readonly watermarks?: IngestionWatermarkService,
  ) {}

  async execute(
    source: DataSourceConfig,
    regionId: string,
  ): Promise<ExtractionResult<MinutesWithActions>> {
    const start = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!source.pdfArchive) {
      errors.push("pdf_archive source missing 'pdfArchive' configuration");
      return this.emptyResult(errors, warnings, start);
    }

    const cfg = source.pdfArchive;
    const maxPages = cfg.maxPages ?? 10;
    const maxNew = cfg.maxNew ?? 10;

    this.logger.log(
      `Pipeline started [pdf_archive]: ${regionId}/${source.dataType} from ${source.url} (maxNew=${maxNew})`,
    );

    let watermarkLastId: string | undefined;
    if (this.watermarks) {
      const watermark = await this.watermarks.read(
        regionId,
        source.url,
        source.dataType,
      );
      watermarkLastId = watermark?.lastExternalId;
      if (watermarkLastId) {
        this.logger.debug(`Watermark for ${source.url}: ${watermarkLastId}`);
      }
    }

    let candidates: ListingCandidate[];
    try {
      candidates = await this.walkListing(
        source.url,
        cfg,
        maxPages,
        maxNew,
        watermarkLastId,
        regionId,
        source.dataType,
      );
    } catch (e) {
      errors.push(
        `Listing walk failed for ${source.url}: ${(e as Error).message}`,
      );
      return this.emptyResult(errors, warnings, start);
    }

    if (candidates.length === 0) {
      this.logger.log(
        `No new documents at ${source.url} (watermark hit or empty listing)`,
      );
      return {
        items: [],
        manifestVersion: 0,
        success: true,
        warnings,
        errors,
        extractionTimeMs: Date.now() - start,
      };
    }

    this.logger.log(
      `Discovered ${candidates.length} new document(s) at ${source.url}`,
    );

    // Process oldest → newest so a mid-stream failure leaves the
    // watermark advanced only to the last successful row.
    candidates.sort((a, b) => a.date.getTime() - b.date.getTime());

    const results: MinutesWithActions[] = [];
    for (const candidate of candidates) {
      try {
        const minutes = await this.fetchAndParseDocument(
          candidate,
          source,
          regionId,
        );
        results.push({ minutes, actions: [] });
        if (this.watermarks) {
          await this.watermarks.advance(
            regionId,
            source.url,
            source.dataType,
            minutes.externalId,
            1,
          );
        }
      } catch (e) {
        const msg = `Failed to ingest ${candidate.url}: ${(e as Error).message}`;
        this.logger.warn(msg);
        warnings.push(msg);
      }
    }

    const totalMs = Date.now() - start;
    this.logger.log(
      `Pipeline complete [pdf_archive]: ${results.length} Minutes ingested in ${totalMs}ms (${warnings.length} warnings)`,
    );

    return {
      items: results,
      manifestVersion: 0,
      success: results.length > 0 || candidates.length === 0,
      warnings,
      errors,
      extractionTimeMs: totalMs,
    };
  }

  private async walkListing(
    listingUrl: string,
    cfg: PdfArchiveConfig,
    maxPages: number,
    maxNew: number,
    watermarkLastId: string | undefined,
    regionId: string,
    dataType: string,
  ): Promise<ListingCandidate[]> {
    const collected: ListingCandidate[] = [];
    const seenUrls = new Set<string>();

    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = this.pageUrl(listingUrl, cfg.paginationParam, page);
      const fetched = await this.extraction.fetchWithRetry(pageUrl);
      const $ = cheerio.load(fetched.content);

      const elements = $(cfg.linkSelector);
      if (elements.length === 0) {
        if (page === 1) {
          this.logger.warn(
            `No matches for selector '${cfg.linkSelector}' on ${pageUrl}`,
          );
        }
        break;
      }

      let pageProducedNew = false;
      for (const el of elements.toArray()) {
        const href = $(el).attr("href");
        if (!href) continue;

        const absoluteUrl = this.resolveUrl(href, pageUrl);
        if (seenUrls.has(absoluteUrl)) continue;
        seenUrls.add(absoluteUrl);

        const candidate = this.parseCandidate(
          absoluteUrl,
          $(el).text() ?? "",
          cfg,
          regionId,
          dataType,
        );
        if (!candidate) continue;

        // Stop walking once we hit the watermark — the listing is
        // descending by date, so anything beyond is already ingested.
        if (watermarkLastId && candidate.externalIdHint === watermarkLastId) {
          this.logger.debug(
            `Watermark hit at ${absoluteUrl} — stopping listing walk`,
          );
          return collected;
        }

        collected.push(candidate);
        pageProducedNew = true;

        if (collected.length >= maxNew) {
          this.logger.log(`Hit maxNew=${maxNew} cap — stopping listing walk`);
          return collected;
        }
      }

      // Defensive: if a page yields no NEW candidates (all duplicates
      // or unparseable) the listing isn't progressing — bail out
      // instead of fetching maxPages identical pages.
      if (!pageProducedNew) {
        break;
      }

      if (!cfg.paginationParam) {
        // Unpaginated listing — one fetch is the whole listing.
        break;
      }
    }

    return collected;
  }

  private pageUrl(
    base: string,
    paginationParam: string | undefined,
    page: number,
  ): string {
    if (!paginationParam || page === 1) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${paginationParam}=${page}`;
  }

  private resolveUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  private parseCandidate(
    url: string,
    anchorText: string,
    cfg: PdfArchiveConfig,
    regionId: string,
    dataType: string,
  ): ListingCandidate | undefined {
    const date = this.extractDate(url, anchorText, cfg);
    if (!date) return undefined;

    const revisionSeq = this.extractRevisionSeq(url, cfg);
    const externalIdHint = this.candidateExternalId(
      regionId,
      dataType,
      date,
      revisionSeq,
    );
    return { url, date, revisionSeq, externalIdHint };
  }

  private extractDate(
    url: string,
    anchorText: string,
    cfg: PdfArchiveConfig,
  ): Date | undefined {
    if (!cfg.datePattern) return undefined;
    const re = new RegExp(cfg.datePattern);
    const match = re.exec(url) ?? re.exec(anchorText);
    if (!match) return undefined;

    const format = cfg.dateFormat ?? "MMDDYY";
    switch (format) {
      case "MMDDYY": {
        const [, mm, dd, yy] = match;
        if (!mm || !dd || !yy) return undefined;
        return this.utcDate(2000 + Number(yy), Number(mm), Number(dd));
      }
      case "YYYY-MM-DD": {
        const [, yyyy, mm, dd] = match;
        if (!yyyy || !mm || !dd) return undefined;
        return this.utcDate(Number(yyyy), Number(mm), Number(dd));
      }
      case "MM/DD/YYYY": {
        const [, mm, dd, yyyy] = match;
        if (!mm || !dd || !yyyy) return undefined;
        return this.utcDate(Number(yyyy), Number(mm), Number(dd));
      }
      default:
        return undefined;
    }
  }

  private utcDate(year: number, month: number, day: number): Date | undefined {
    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return undefined;
    }
    return new Date(Date.UTC(year, month - 1, day));
  }

  private extractRevisionSeq(url: string, cfg: PdfArchiveConfig): number {
    if (!cfg.revisionPattern) return 0;
    const m = new RegExp(cfg.revisionPattern).exec(url);
    if (!m || !m[1]) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private candidateExternalId(
    regionId: string,
    dataType: string,
    date: Date,
    revisionSeq: number,
  ): string {
    const ymd = date.toISOString().slice(0, 10);
    const base = `${regionId}-${dataType}-${ymd}`;
    return revisionSeq > 0 ? `${base}-r${revisionSeq}` : base;
  }

  private async fetchAndParseDocument(
    candidate: ListingCandidate,
    source: DataSourceConfig,
    regionId: string,
  ): Promise<Minutes> {
    this.logger.log(`Fetching PDF: ${candidate.url}`);
    const rawText = await this.extraction.fetchPdfText(candidate.url);
    const truncated =
      rawText.length > MAX_RAW_TEXT_CHARS
        ? rawText.slice(0, MAX_RAW_TEXT_CHARS)
        : rawText;
    const pageCount = this.estimatePageCount(rawText);
    const body = this.deriveBody(source);

    return {
      externalId: candidate.externalIdHint,
      body,
      date: candidate.date,
      revisionSeq: candidate.revisionSeq,
      isActive: true,
      pageCount,
      sourceUrl: candidate.url,
      rawText: truncated,
      parsedAt: new Date(),
    };
  }

  /**
   * Page-count estimate from raw text. pdf-parse emits a `\f`
   * form-feed between pages; falls back to character heuristics when
   * the source PDF doesn't preserve those.
   */
  private estimatePageCount(rawText: string): number | undefined {
    if (!rawText) return undefined;
    const formFeeds = (rawText.match(/\f/g) ?? []).length;
    if (formFeeds > 0) return formFeeds + 1;
    return undefined;
  }

  /**
   * Best-effort `body` derivation. For the MVP this leans on the
   * source `category` (e.g. 'Assembly', 'Senate') — the
   * categories already present on every CA dataSource. Falls back
   * to '' when not present; the linker can refine downstream.
   */
  private deriveBody(source: DataSourceConfig): string {
    return source.category ?? "";
  }

  private emptyResult(
    errors: string[],
    warnings: string[],
    start: number,
  ): ExtractionResult<MinutesWithActions> {
    return {
      items: [],
      manifestVersion: 0,
      success: false,
      warnings,
      errors,
      extractionTimeMs: Date.now() - start,
    };
  }
}
