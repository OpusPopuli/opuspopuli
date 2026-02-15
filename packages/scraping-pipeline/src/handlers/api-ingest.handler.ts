/**
 * API Ingest Handler
 *
 * Makes paginated REST API requests, extracts items from JSON responses,
 * and maps to domain types. No AI analysis needed — the response structure
 * is defined declaratively in the config.
 *
 * Supports pagination strategies: offset, cursor, page.
 * API keys are resolved from environment variables at runtime.
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  ApiSourceConfig,
  DataSourceConfig,
  ExtractionResult,
  RawExtractionResult,
} from "@opuspopuli/common";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";

/** Maximum pages to fetch in a single pipeline run (safety limit) */
const MAX_PAGES = 10;

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 60_000;

/** Delay between paginated requests in milliseconds */
const PAGE_DELAY_MS = 250;

@Injectable()
export class ApiIngestHandler {
  private readonly logger = new Logger(ApiIngestHandler.name);

  constructor(private readonly mapper: DomainMapperService) {}

  async execute<T>(
    source: DataSourceConfig,
    _regionId: string,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    const api = source.api!;
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Resolve API key
      const apiKey = this.resolveApiKey(api);

      // 2. Fetch all pages
      const allItems = await this.fetchAllPages(
        source.url,
        api,
        apiKey,
        warnings,
      );

      this.logger.log(
        `Fetched ${allItems.length} items from API ${source.url}`,
      );

      // 3. Inject sourceSystem based on category
      const sourceSystem = this.inferSourceSystem(source);
      if (sourceSystem) {
        for (const item of allItems) {
          if (!item["sourceSystem"]) {
            item["sourceSystem"] = sourceSystem;
          }
        }
      }

      // 4. Map through domain mapper
      const rawResult: RawExtractionResult = {
        items: allItems,
        success: allItems.length > 0,
        warnings,
        errors,
      };

      const result = this.mapper.map<T>(rawResult, source);
      result.extractionTimeMs = Date.now() - pipelineStart;
      return result;
    } catch (error) {
      errors.push((error as Error).message);
      return {
        items: [],
        manifestVersion: 0,
        success: false,
        warnings,
        errors,
        extractionTimeMs: Date.now() - pipelineStart,
      };
    }
  }

  /**
   * Resolve API key from environment variable.
   */
  private resolveApiKey(api: ApiSourceConfig): string | undefined {
    if (!api.apiKeyEnvVar) return undefined;

    const key = process.env[api.apiKeyEnvVar];
    if (!key) {
      this.logger.warn(`API key env var '${api.apiKeyEnvVar}' not set`);
    }
    return key;
  }

  /**
   * Fetch all pages from a paginated API endpoint.
   */
  private async fetchAllPages(
    baseUrl: string,
    api: ApiSourceConfig,
    apiKey: string | undefined,
    warnings: string[],
  ): Promise<Record<string, unknown>[]> {
    const allItems: Record<string, unknown>[] = [];
    let page = 0;
    let cursor: string | undefined;

    while (page < MAX_PAGES) {
      const { items, body } = await this.fetchPage(
        baseUrl,
        api,
        apiKey,
        page,
        cursor,
      );

      if (items.length === 0) {
        this.logger.debug(`No more items on page ${page + 1}`);
        break;
      }

      allItems.push(...items);
      page++;

      const nextCursor = this.shouldContinue(api, items, body);
      if (nextCursor === false) break;
      cursor = nextCursor || undefined;

      await this.delay(PAGE_DELAY_MS);
    }

    if (page >= MAX_PAGES) {
      warnings.push(
        `Reached max page limit (${MAX_PAGES}). More data may be available.`,
      );
    }

    return allItems;
  }

  /**
   * Fetch a single page from the API.
   */
  private async fetchPage(
    baseUrl: string,
    api: ApiSourceConfig,
    apiKey: string | undefined,
    page: number,
    cursor: string | undefined,
  ): Promise<{
    items: Record<string, unknown>[];
    body: Record<string, unknown>;
  }> {
    const url = this.buildPageUrl(baseUrl, api, apiKey, page, cursor);
    this.logger.debug(`Fetching page ${page + 1}: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      method: api.method ?? "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `API error HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const body = (await response.json()) as Record<string, unknown>;
    const resultsPath = api.resultsPath ?? "results";
    const items = this.extractItems(body, resultsPath);

    return { items, body };
  }

  /**
   * Determine whether to continue pagination.
   * Returns false to stop, or the cursor string for cursor-based pagination.
   */
  private shouldContinue(
    api: ApiSourceConfig,
    items: Record<string, unknown>[],
    body: Record<string, unknown>,
  ): string | false {
    const pagination = api.pagination;
    if (!pagination) return false;

    if (pagination.type === "cursor") {
      const cursor = this.extractCursor(body);
      return cursor || false;
    }

    // For offset/page pagination, stop if we got fewer items than the limit
    const limit = pagination.limit ?? 100;
    return items.length < limit ? false : "";
  }

  /**
   * Build the URL for a specific page of results.
   */
  private buildPageUrl(
    baseUrl: string,
    api: ApiSourceConfig,
    apiKey: string | undefined,
    page: number,
    cursor: string | undefined,
  ): URL {
    const url = new URL(baseUrl);

    // Add static query parameters from config
    if (api.queryParams) {
      for (const [key, value] of Object.entries(api.queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    // Add API key (as query parameter)
    if (apiKey && api.apiKeyHeader) {
      url.searchParams.set(api.apiKeyHeader, apiKey);
    }

    // Add pagination parameters
    if (api.pagination) {
      const { type, pageParam, limitParam, limit } = api.pagination;
      const effectiveLimit = limit ?? 100;

      // Always send the limit/per_page parameter
      url.searchParams.set(limitParam ?? "per_page", String(effectiveLimit));

      switch (type) {
        case "offset": {
          const offset = page * effectiveLimit;
          url.searchParams.set(pageParam ?? "offset", String(offset));
          break;
        }
        case "page": {
          if (page > 0) {
            url.searchParams.set(pageParam ?? "page", String(page + 1));
          }
          break;
        }
        case "cursor": {
          if (cursor) {
            url.searchParams.set("last_index", cursor);
          }
          break;
        }
      }
    }

    return url;
  }

  /**
   * Extract items array from a JSON response using a dot-separated path.
   * e.g., "results" → body.results, "data.items" → body.data.items
   */
  private extractItems(
    body: Record<string, unknown>,
    resultsPath: string,
  ): Record<string, unknown>[] {
    const parts = resultsPath.split(".");
    let current: unknown = body;

    for (const part of parts) {
      if (
        current &&
        typeof current === "object" &&
        !Array.isArray(current) &&
        part in (current as Record<string, unknown>)
      ) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return [];
      }
    }

    if (!Array.isArray(current)) return [];
    return current as Record<string, unknown>[];
  }

  /**
   * Extract cursor value for next page from API response.
   * Handles FEC-style pagination: { pagination: { last_indexes: { last_index: "..." } } }
   */
  private extractCursor(body: Record<string, unknown>): string | undefined {
    const pagination = body["pagination"] as
      | Record<string, unknown>
      | undefined;
    if (!pagination) return undefined;

    // FEC style: pagination.last_indexes.last_index
    const lastIndexes = pagination["last_indexes"] as
      | Record<string, unknown>
      | undefined;
    if (lastIndexes) {
      const cursor = lastIndexes["last_index"];
      if (typeof cursor === "string" || typeof cursor === "number") {
        return String(cursor);
      }
    }

    // Generic: pagination.last_index or pagination.cursor or pagination.next_cursor
    for (const key of ["last_index", "cursor", "next_cursor", "next"]) {
      const val = pagination[key];
      if (typeof val === "string" || typeof val === "number") {
        return String(val);
      }
    }

    return undefined;
  }

  /**
   * Infer the sourceSystem value from the data source category.
   */
  private inferSourceSystem(source: DataSourceConfig): string | undefined {
    const cat = (source.category ?? "").toLowerCase();
    if (cat.includes("cal-access") || cat.includes("cal_access")) {
      return "cal_access";
    }
    if (cat.includes("fec")) return "fec";
    return undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
