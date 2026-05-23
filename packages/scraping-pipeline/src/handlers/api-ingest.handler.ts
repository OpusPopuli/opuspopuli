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
} from "@opuspopuli/common";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";
import {
  ExecutionTrackerService,
  type ExecutionSession,
} from "../pipeline/execution-tracker.service.js";
import {
  inferSourceSystem,
  buildFailureResult,
  mapAndReturn,
  mapBatchItems,
} from "./handler-utils.js";

/** Maximum pages to fetch in a single pipeline run (safety limit) */
const MAX_PAGES = 10;

/** Request timeout in milliseconds (FEC API can take 1-40s per page) */
const REQUEST_TIMEOUT_MS = 120_000;

/** Delay between paginated requests in milliseconds */
const PAGE_DELAY_MS = 250;

@Injectable()
export class ApiIngestHandler {
  private readonly logger = new Logger(ApiIngestHandler.name);

  constructor(
    private readonly mapper: DomainMapperService,
    private readonly executionTracker: ExecutionTrackerService | null = null,
  ) {}

  async execute<T>(
    source: DataSourceConfig,
    regionId: string,
    onBatch?: (items: T[]) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    const api = source.api!;
    const warnings: string[] = [];
    const errors: string[] = [];
    const sourceSystem = inferSourceSystem(source);

    try {
      const apiKey = this.resolveApiKey(api);

      if (onBatch) {
        // Streaming mode: map and flush each page via callback.
        const session: ExecutionSession =
          await ExecutionTrackerService.beginSession(
            this.executionTracker,
            pipelineJobId,
            {
              regionId,
              sourceUrl: source.url,
              dataType: source.dataType,
            },
          );

        let totalItems = 0;
        let streamSuccess = false;

        try {
          await this.fetchAllPages(
            source.url,
            api,
            apiKey,
            warnings,
            async (rawPageItems, pageIndex) => {
              // Apply per-page transformations before domain mapping.
              if (api.fieldMappings) {
                for (const item of rawPageItems) {
                  this.remapFields(item, api.fieldMappings);
                }
              }
              if (sourceSystem) {
                for (const item of rawPageItems) {
                  if (!item["sourceSystem"])
                    item["sourceSystem"] = sourceSystem;
                }
              }

              const items = mapBatchItems<T>(
                rawPageItems,
                source,
                this.mapper,
                warnings,
              );

              if (items.length === 0) return;

              if (session.appliedBatches.has(pageIndex)) {
                this.logger.debug(
                  `Skipping already-applied page ${pageIndex} for ${source.url}`,
                );
                return;
              }

              // onBatch (upsert) runs before recordBatch intentionally:
              // if recordBatch fails transiently, the upsert is idempotent
              // and the batch will be re-applied on retry — acceptable.
              await onBatch(items);
              totalItems += items.length;

              await session.recordBatch(pageIndex, items.length);
            },
          );
          streamSuccess = true;
        } finally {
          await session.finalize(streamSuccess, {
            itemsExtracted: totalItems,
            itemsFailed: 0,
            extractionTimeMs: Date.now() - pipelineStart,
          });
        }

        this.logger.log(`Streamed ${totalItems} items from API ${source.url}`);

        return {
          items: [],
          manifestVersion: 0,
          success: totalItems > 0,
          warnings,
          errors,
          extractionTimeMs: Date.now() - pipelineStart,
          itemCount: totalItems,
        };
      }

      // Non-streaming (accumulation) mode — original behavior preserved.
      const allItems = await this.fetchAllPages(
        source.url,
        api,
        apiKey,
        warnings,
      );

      this.logger.log(
        `Fetched ${allItems.length} items from API ${source.url}`,
      );

      if (api.fieldMappings) {
        for (const item of allItems) {
          this.remapFields(item, api.fieldMappings);
        }
      }

      if (sourceSystem) {
        for (const item of allItems) {
          if (!item["sourceSystem"]) {
            item["sourceSystem"] = sourceSystem;
          }
        }
      }

      return mapAndReturn<T>(
        allItems,
        warnings,
        errors,
        source,
        this.mapper,
        pipelineStart,
      );
    } catch (error) {
      return buildFailureResult<T>(error, warnings, errors, pipelineStart);
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
   *
   * When onPage is provided (streaming mode), each page's items are passed to
   * the callback and NOT accumulated — returns an empty array. Cursor state is
   * always maintained so pagination advances correctly even when a callback
   * skips writing items (e.g. already-applied pages on retry).
   *
   * When omitted (accumulation mode), all items are collected and returned.
   */
  private async fetchAllPages(
    baseUrl: string,
    api: ApiSourceConfig,
    apiKey: string | undefined,
    warnings: string[],
    onPage?: (
      items: Record<string, unknown>[],
      pageIndex: number,
    ) => Promise<void>,
  ): Promise<Record<string, unknown>[]> {
    const allItems: Record<string, unknown>[] = [];
    let page = 0;
    let cursorParams: Record<string, string> | undefined;

    while (page < MAX_PAGES) {
      const { items, body } = await this.fetchPage(
        baseUrl,
        api,
        apiKey,
        page,
        cursorParams,
      );

      if (items.length === 0) {
        this.logger.debug(`No more items on page ${page + 1}`);
        break;
      }

      if (onPage) {
        await onPage(items, page);
      } else {
        allItems.push(...items);
      }
      page++;

      const nextCursor = this.extractCursorParams(api, items, body);
      if (!nextCursor) break;
      cursorParams = nextCursor;

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
    cursorParams: Record<string, string> | undefined,
  ): Promise<{
    items: Record<string, unknown>[];
    body: Record<string, unknown>;
  }> {
    const url = this.buildPageUrl(baseUrl, api, apiKey, page, cursorParams);
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
   * Extract cursor parameters for the next page.
   * Returns undefined to stop, or a Record of all cursor params needed.
   */
  private extractCursorParams(
    api: ApiSourceConfig,
    items: Record<string, unknown>[],
    body: Record<string, unknown>,
  ): Record<string, string> | undefined {
    const pagination = api.pagination;
    if (!pagination) return undefined;

    if (pagination.type === "cursor") {
      return this.extractAllCursorValues(body);
    }

    // For offset/page pagination, stop if we got fewer items than the limit
    const limit = pagination.limit ?? 100;
    return items.length < limit ? undefined : {};
  }

  /**
   * Build the URL for a specific page of results.
   */
  private buildPageUrl(
    baseUrl: string,
    api: ApiSourceConfig,
    apiKey: string | undefined,
    page: number,
    cursorParams: Record<string, string> | undefined,
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
      this.applyPaginationParams(url, api.pagination, page, cursorParams);
    }

    return url;
  }

  /**
   * Apply pagination-specific query parameters to a URL.
   */
  private applyPaginationParams(
    url: URL,
    pagination: NonNullable<ApiSourceConfig["pagination"]>,
    page: number,
    cursorParams: Record<string, string> | undefined,
  ): void {
    const { type, pageParam, limitParam, limit } = pagination;
    const effectiveLimit = limit ?? 100;

    url.searchParams.set(limitParam ?? "per_page", String(effectiveLimit));

    switch (type) {
      case "offset":
        url.searchParams.set(
          pageParam ?? "offset",
          String(page * effectiveLimit),
        );
        break;
      case "page":
        if (page > 0) {
          url.searchParams.set(pageParam ?? "page", String(page + 1));
        }
        break;
      case "cursor":
        if (cursorParams) {
          for (const [key, value] of Object.entries(cursorParams)) {
            url.searchParams.set(key, value);
          }
        }
        break;
    }
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
   * Extract all cursor values for next page from API response.
   * FEC-style: { pagination: { last_indexes: { last_index: "...", sort_null_only: true, last_X: "..." } } }
   * Sends ALL values from last_indexes as query params — FEC requires them all.
   */
  private extractAllCursorValues(
    body: Record<string, unknown>,
  ): Record<string, string> | undefined {
    const pagination = body["pagination"] as
      | Record<string, unknown>
      | undefined;
    if (!pagination) return undefined;

    // FEC style: pagination.last_indexes contains all cursor params
    const lastIndexes = pagination["last_indexes"] as
      | Record<string, unknown>
      | undefined;
    if (lastIndexes) {
      const params: Record<string, string> = {};
      let hasValues = false;
      for (const [key, value] of Object.entries(lastIndexes)) {
        if (
          value !== null &&
          value !== undefined &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean")
        ) {
          params[key] = String(value);
          hasValues = true;
        }
      }
      return hasValues ? params : undefined;
    }

    // Generic fallback: look for common cursor keys
    for (const key of ["last_index", "cursor", "next_cursor", "next"]) {
      const val = pagination[key];
      if (typeof val === "string" || typeof val === "number") {
        return { [key]: String(val) };
      }
    }

    return undefined;
  }

  /**
   * Remap field names on a record using a mapping dictionary.
   * Renames keys in-place (e.g., "committee_id" → "committeeId").
   */
  private remapFields(
    record: Record<string, unknown>,
    mappings: Record<string, string>,
  ): void {
    for (const [sourceKey, targetKey] of Object.entries(mappings)) {
      if (sourceKey in record && sourceKey !== targetKey) {
        record[targetKey] = record[sourceKey];
        delete record[sourceKey];
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
