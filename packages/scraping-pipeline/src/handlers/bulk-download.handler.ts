/**
 * Bulk Download Handler
 *
 * Downloads ZIP/CSV/TSV files, extracts target files from archives,
 * parses rows using column mappings, applies filters, and maps to domain types.
 *
 * Uses streaming to avoid loading entire files into memory:
 * - Downloads stream to a temp file on disk
 * - Uses yauzl for streaming ZIP extraction (reads central directory from disk)
 * - Parses lines one-at-a-time via readline
 * - Cleans up temp file after processing
 *
 * No AI analysis needed — the schema is defined declaratively in the config.
 */

import { Injectable, Logger } from "@nestjs/common";
import { createWriteStream, createReadStream } from "node:fs";
import { unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import yauzl from "yauzl";
import type {
  BulkDownloadConfig,
  DataSourceConfig,
  ExtractionResult,
  RawExtractionResult,
} from "@opuspopuli/common";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";

/** Download timeout: 30 minutes for very large files (FEC indiv26.zip is ~1.4GB) */
const DOWNLOAD_TIMEOUT_MS = 1_800_000;

/** Default batch size for record processing (trades memory for fewer DB round-trips) */
const DEFAULT_BATCH_SIZE = 10_000;

/** Callback invoked with each batch of mapped domain objects */
export type OnBatchCallback<T> = (items: T[]) => Promise<void>;

@Injectable()
export class BulkDownloadHandler {
  private readonly logger = new Logger(BulkDownloadHandler.name);

  constructor(private readonly mapper: DomainMapperService) {}

  async execute<T>(
    source: DataSourceConfig,
    _regionId: string,
    onBatch?: OnBatchCallback<T>,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    const bulk = source.bulk!;
    const warnings: string[] = [];
    const errors: string[] = [];
    const tmpPath = join(tmpdir(), `opus-bulk-${randomUUID()}.tmp`);

    try {
      // 1. Stream download to temp file (no memory buffering)
      this.logger.log(`Downloading ${source.url}...`);
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response has no body");
      }

      // Convert web ReadableStream to Node Readable if needed
      const bodyStream =
        response.body instanceof Readable
          ? response.body
          : Readable.fromWeb(
              response.body as import("node:stream/web").ReadableStream,
            );

      await pipeline(bodyStream, createWriteStream(tmpPath));

      const fileSize = (await stat(tmpPath)).size;
      this.logger.log(
        `Downloaded ${(fileSize / 1024 / 1024).toFixed(1)}MB to temp file`,
      );

      // 2. Get a readable stream for the target content
      let contentStream: Readable;
      const isZip = bulk.format.startsWith("zip_");

      if (isZip) {
        contentStream = await this.extractZipEntryStream(tmpPath, bulk);
      } else {
        contentStream = createReadStream(tmpPath, { encoding: "utf-8" });
      }

      // 3. Parse and process in batches (streaming)
      if (onBatch) {
        // Batch mode: map and flush each batch via callback, never accumulate all records
        const batchSize = bulk.batchSize ?? DEFAULT_BATCH_SIZE;
        let totalItems = 0;

        await this.parseDelimitedStream(
          contentStream,
          bulk,
          source,
          async (rawBatch) => {
            const rawResult: RawExtractionResult = {
              items: rawBatch,
              success: rawBatch.length > 0,
              warnings: [],
              errors: [],
            };
            const mapped = this.mapper.map<T>(rawResult, source);
            warnings.push(...mapped.warnings);
            if (mapped.items.length > 0) {
              await onBatch(mapped.items);
              totalItems += mapped.items.length;
            }
          },
          batchSize,
        );

        this.logger.log(
          `Processed ${totalItems} records in batches from ${bulk.filePattern ?? source.url}`,
        );

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

      // Non-batch mode: accumulate all records (legacy path for small files)
      const rawRecords = await this.parseDelimitedStream(
        contentStream,
        bulk,
        source,
      );

      this.logger.log(
        `Parsed ${rawRecords.length} records from ${bulk.filePattern ?? source.url}`,
      );

      const rawResult: RawExtractionResult = {
        items: rawRecords,
        success: rawRecords.length > 0,
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
    } finally {
      // Always clean up temp file
      await unlink(tmpPath).catch(() => {});
    }
  }

  /** Maximum uncompressed file size: 10GB (safety limit against zip bombs) */
  private static readonly MAX_UNCOMPRESSED_SIZE = 10 * 1024 * 1024 * 1024;

  /**
   * Extract a target file from a ZIP archive as a readable stream.
   * Uses yauzl for streaming extraction — reads central directory from disk,
   * not memory. Only the decompressed entry is streamed.
   *
   * SECURITY: Validates entry names for path traversal and enforces a max
   * uncompressed size to protect against zip bombs.
   */
  private extractZipEntryStream(
    zipPath: string,
    bulk: BulkDownloadConfig,
  ): Promise<Readable> {
    const pattern = bulk.filePattern;
    if (!pattern) {
      return Promise.reject(
        new Error("ZIP format requires filePattern in bulk config"),
      );
    }

    return new Promise((resolve, reject) => {
      // SECURITY: Archive expansion is safe here because:
      // 1. lazyEntries: true prevents automatic iteration — we validate each entry
      // 2. Path traversal check rejects entries containing ".." or starting with "/"
      // 3. Zip bomb check rejects entries exceeding MAX_UNCOMPRESSED_SIZE (10GB)
      // 4. Only a single whitelisted entry (matching filePattern) is extracted
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        // NOSONAR
        if (err || !zipfile) {
          reject(err ?? new Error("Failed to open ZIP"));
          return;
        }

        zipfile.readEntry();

        zipfile.on("entry", (entry) => {
          const name = entry.fileName;

          // SECURITY: Reject path traversal attempts (e.g., "../../../etc/passwd")
          if (name.includes("..") || name.startsWith("/")) {
            this.logger.warn(
              `Skipping ZIP entry with suspicious path: ${name}`,
            );
            zipfile.readEntry();
            return;
          }

          const matches =
            name === pattern ||
            name.endsWith(`/${pattern}`) ||
            name.toUpperCase() === pattern.toUpperCase();

          if (matches) {
            // SECURITY: Reject entries that exceed max uncompressed size (zip bomb protection)
            if (
              entry.uncompressedSize > BulkDownloadHandler.MAX_UNCOMPRESSED_SIZE
            ) {
              reject(
                new Error(
                  `ZIP entry ${name} exceeds max size: ${(entry.uncompressedSize / 1024 / 1024 / 1024).toFixed(1)}GB`,
                ),
              );
              return;
            }

            this.logger.log(
              `Extracting ${name} (${(entry.uncompressedSize / 1024 / 1024).toFixed(1)}MB uncompressed)`,
            );

            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) {
                reject(streamErr ?? new Error("Failed to open entry stream"));
                return;
              }
              readStream.on("end", () => zipfile.close());
              resolve(readStream);
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on("end", () => {
          reject(new Error(`File '${pattern}' not found in ZIP archive`));
        });

        zipfile.on("error", reject);
      });
    });
  }

  /**
   * Parse delimited content from a stream, line-by-line.
   * Applies column mappings and filters without loading the entire file.
   *
   * When onBatch is provided, records are flushed in batches and never
   * all held in memory. When omitted, all records accumulate and are returned.
   */
  private async parseDelimitedStream(
    stream: Readable,
    bulk: BulkDownloadConfig,
    source: DataSourceConfig,
    onBatch?: (batch: Record<string, unknown>[]) => Promise<void>,
    batchSize?: number,
  ): Promise<Record<string, unknown>[]> {
    if (onBatch) {
      return this.parseWithBatching(stream, bulk, source, onBatch, batchSize);
    }
    return this.parseWithAccumulation(stream, bulk, source);
  }

  /**
   * Batch mode: flush records to callback in chunks, never holding all in memory.
   */
  private async parseWithBatching(
    stream: Readable,
    bulk: BulkDownloadConfig,
    source: DataSourceConfig,
    onBatch: (batch: Record<string, unknown>[]) => Promise<void>,
    batchSize?: number,
  ): Promise<Record<string, unknown>[]> {
    const effectiveBatchSize = batchSize ?? DEFAULT_BATCH_SIZE;
    let batch: Record<string, unknown>[] = [];
    let totalParsed = 0;

    const lineParser = this.createLineParser(bulk, source);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const record = lineParser.processLine(line);
      if (!record) continue;

      batch.push(record);
      if (batch.length >= effectiveBatchSize) {
        await onBatch(batch);
        totalParsed += batch.length;
        this.logger.debug(
          `Flushed batch of ${batch.length} records (${totalParsed} total)`,
        );
        batch = [];
      }
    }

    if (batch.length > 0) {
      await onBatch(batch);
      totalParsed += batch.length;
    }

    this.logger.log(`Parsed ${totalParsed} records in batches`);
    return [];
  }

  /**
   * Accumulation mode: collect all records in memory (with safety limit).
   */
  private async parseWithAccumulation(
    stream: Readable,
    bulk: BulkDownloadConfig,
    source: DataSourceConfig,
  ): Promise<Record<string, unknown>[]> {
    const MAX_RECORDS = 100_000;
    const records: Record<string, unknown>[] = [];

    const lineParser = this.createLineParser(bulk, source);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const record = lineParser.processLine(line);
      if (!record) continue;

      records.push(record);
      if (records.length >= MAX_RECORDS) {
        this.logger.warn(
          `Reached max records limit (${MAX_RECORDS}). Stopping parse.`,
        );
        rl.close();
        break;
      }
    }

    return records;
  }

  /**
   * Create a stateful line parser that handles headers, skipping, and mapping.
   */
  private createLineParser(bulk: BulkDownloadConfig, source: DataSourceConfig) {
    const delimiter = this.getDelimiter(bulk);
    const mappings = bulk.columnMappings;
    const filters = bulk.filters ?? {};
    const sourceSystem = this.inferSourceSystem(source);
    const headerSkip = bulk.headerLines ?? 0;

    let lineNum = 0;
    let colIndices: Record<string, number> = {};
    let filterIndices: Record<string, number> = {};

    const hasExplicitHeaders = bulk.headers && bulk.headers.length > 0;
    if (hasExplicitHeaders) {
      const headers = bulk.headers!;
      colIndices = this.buildColumnIndices(headers, mappings);
      filterIndices = this.buildColumnIndices(headers, filters);
    }

    const headerLineNum = headerSkip;
    const buildIndices = this.buildColumnIndices.bind(this);
    const processData = this.processDataLine.bind(this);

    return {
      processLine(line: string): Record<string, unknown> | null {
        if (lineNum < headerSkip) {
          lineNum++;
          return null;
        }

        if (!hasExplicitHeaders && lineNum === headerLineNum) {
          const headers = line
            .split(delimiter)
            .map((h) => BulkDownloadHandler.stripQuotes(h));
          colIndices = buildIndices(headers, mappings);
          filterIndices = buildIndices(headers, filters);
          lineNum++;
          return null;
        }

        lineNum++;
        return processData(
          line,
          delimiter,
          mappings,
          filters,
          colIndices,
          filterIndices,
          sourceSystem,
        );
      },
    };
  }

  /**
   * Process a single data line: split, filter, map, inject sourceSystem.
   * Returns null if the line should be skipped.
   */
  private processDataLine(
    line: string,
    delimiter: string,
    mappings: Record<string, string>,
    filters: Record<string, string>,
    colIndices: Record<string, number>,
    filterIndices: Record<string, number>,
    sourceSystem: string | undefined,
  ): Record<string, unknown> | null {
    if (!line.trim()) return null;

    const values = line.split(delimiter);

    if (!this.passesFilters(values, filters, filterIndices)) return null;

    const record = this.mapRow(values, mappings, colIndices);

    if (sourceSystem && !record["sourceSystem"]) {
      record["sourceSystem"] = sourceSystem;
    }

    const fieldCount = Object.keys(record).length;
    const minFields = sourceSystem ? 2 : 1;
    return fieldCount >= minFields ? record : null;
  }

  /**
   * Determine the column delimiter from the config.
   */
  private getDelimiter(bulk: BulkDownloadConfig): string {
    if (bulk.delimiter) return bulk.delimiter;
    const format = bulk.format.replaceAll("zip_", "");
    return format === "tsv" ? "\t" : ",";
  }

  /**
   * Strip surrounding double quotes and trim whitespace from a CSV cell value.
   */
  private static stripQuotes(val: string): string {
    return val.trim().replaceAll(/(^"|"$)/g, "");
  }

  /**
   * Build a column-index lookup map from headers.
   * Logs warnings for mapped columns not found in the file.
   */
  private buildColumnIndices(
    headers: string[],
    columns: Record<string, string>,
  ): Record<string, number> {
    const indices: Record<string, number> = {};
    for (const col of Object.keys(columns)) {
      const idx = headers.indexOf(col);
      if (idx === -1) {
        this.logger.warn(
          `Column '${col}' not found in file headers. Available: ${headers.slice(0, 10).join(", ")}`,
        );
      } else {
        indices[col] = idx;
      }
    }
    return indices;
  }

  /**
   * Check if a row passes all filter criteria.
   */
  private passesFilters(
    values: string[],
    filters: Record<string, string>,
    filterIndices: Record<string, number>,
  ): boolean {
    for (const [filterCol, filterVal] of Object.entries(filters)) {
      const idx = filterIndices[filterCol];
      if (idx === undefined) continue;
      const cellVal = BulkDownloadHandler.stripQuotes(values[idx] ?? "");
      if (cellVal !== filterVal) return false;
    }
    return true;
  }

  /**
   * Map a row's values to a domain record using column mappings.
   */
  private mapRow(
    values: string[],
    mappings: Record<string, string>,
    colIndices: Record<string, number>,
  ): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [sourceCol, targetField] of Object.entries(mappings)) {
      const idx = colIndices[sourceCol];
      if (idx === undefined) continue;
      const val = BulkDownloadHandler.stripQuotes(values[idx] ?? "");
      if (val) record[targetField] = val;
    }
    return record;
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
}
