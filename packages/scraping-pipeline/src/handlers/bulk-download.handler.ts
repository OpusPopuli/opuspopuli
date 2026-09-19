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
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type {
  BulkSnapshotCandidate,
  IBulkArchive,
} from "./bulk-archive.port.js";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import yauzl from "yauzl";
import type {
  BulkDownloadConfig,
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
  sessionSourceKey,
} from "./handler-utils.js";

/** Download timeout: 30 minutes for very large files (FEC indiv26.zip is ~1.4GB) */
const DOWNLOAD_TIMEOUT_MS = 1_800_000;

/** Default batch size for record processing (trades memory for fewer DB round-trips) */
const DEFAULT_BATCH_SIZE = 10_000;

/**
 * Joins `compositeKey` column values into an `externalId`. Matches the shape
 * single-column ids already have in this codebase (`<FILING_ID>:<LINE_ITEM>`).
 *
 * Note this is a display/identity convention only — nothing parses an id back
 * apart. The one consumer that did (`extractFilingId`) was replaced by a real
 * `filing_id` column in #980, precisely so that changing a key's layout can
 * never silently break a downstream reader again.
 */
const COMPOSITE_KEY_SEPARATOR = ":";

/** Callback invoked with each batch of mapped domain objects */
export type OnBatchCallback<T> = (items: T[]) => Promise<void>;

/**
 * Everything a single data line needs to become a record. Bundled rather than
 * passed positionally — the parameter list had reached the point where adding
 * one more (SonarCloud S107 caps it at 7) traded a readable signature for a
 * lint waiver.
 */
interface ParseContext {
  delimiter: string;
  mappings: Record<string, string>;
  filters: Record<string, string>;
  colIndices: Record<string, number>;
  filterIndices: Record<string, number>;
  compositeIndices: number[];
  sourceSystem: string | undefined;
}

/**
 * SHA-256 of one raw export line, hex-encoded (#1277).
 *
 * The line as read from the decoded stream — bulk exports are read through a
 * text decode, so per-record *bytes* are not separably addressable without
 * re-reading the archive. This is the finest-grained honest witness available
 * at ingest, and it is enough to locate the record in a retained snapshot.
 */
function hashSourceRecord(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

@Injectable()
export class BulkDownloadHandler {
  private readonly logger = new Logger(BulkDownloadHandler.name);

  constructor(
    private readonly mapper: DomainMapperService,
    private readonly executionTracker: ExecutionTrackerService | null = null,
    /**
     * Retains downloaded exports (#1277). Optional: left unbound, bulk
     * ingestion behaves exactly as it did before the archive existed.
     */
    private readonly bulkArchive: IBulkArchive | null = null,
  ) {}

  /**
   * Offer a downloaded export to the bulk archive, if one is bound.
   *
   * Never throws. Retaining a snapshot is bookkeeping alongside an ingest that
   * is the caller's actual goal, and a finance sync measured in tens of hours
   * (#1037) must not be failed by an archive that was unavailable.
   */
  private async archiveSnapshot(
    candidate: BulkSnapshotCandidate,
  ): Promise<void> {
    if (!this.bulkArchive) return;

    try {
      await this.bulkArchive.archive(candidate);
    } catch (error) {
      this.logger.warn(
        `Failed to archive ${candidate.sourceUrl}: ${(error as Error).message}`,
      );
    }
  }

  async execute<T>(
    source: DataSourceConfig,
    regionId: string,
    onBatch?: OnBatchCallback<T>,
    pipelineJobId?: string,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    const bulk = source.bulk!;

    // xlsx is deliberately not handled here. The official spreadsheets that
    // use it are pivot-shaped — a header row per attribute and one column per
    // candidate — so there are no stable column names for `columnMappings` to
    // target, and the figure that matters is a sum across columns. That is
    // domain knowledge. `parseXlsxGrid` reads the sheet; the handler that
    // knows what the columns mean interprets it. Failing loudly here beats
    // emitting rows mapped by a config field that cannot describe the file.
    if (bulk.format === "xlsx") {
      throw new Error(
        `Bulk source ${source.url} declares format "xlsx", which the generic bulk path does not consume. ` +
          `xlsx sources are read by their domain handler via parseXlsxGrid.`,
      );
    }

    // columnMappings is optional on the type so xlsx sources can omit it, which
    // means a delimited source can now reach here without one and parse every
    // row into an object with no domain fields. Checked before the download
    // rather than at first line: these files run to ~1GB, and a config that
    // cannot work should not cost that first.
    if (!bulk.columnMappings) {
      throw new Error(
        `Bulk source ${source.url} (format "${bulk.format}") has no columnMappings`,
      );
    }
    const warnings: string[] = [];
    const errors: string[] = [];
    const tmpPath = join(tmpdir(), `opus-bulk-${randomUUID()}.tmp`);

    // Opened before the download rather than after it: the run began when it
    // began, not when a gigabyte finished transferring, and the archived
    // snapshot needs this id to join to the rows it produced (#1277, #1280).
    //
    // The resume session is keyed by (job, sourceUrl) and `batchIndex` restarts
    // at 0 for each source, so the tracked identity must be unique per source.
    // See sessionSourceKey for why url + filePattern alone is insufficient
    // (#950, #984).
    const trackingUrl = sessionSourceKey(source, bulk.filePattern);
    const session: ExecutionSession =
      await ExecutionTrackerService.beginSession(
        this.executionTracker,
        pipelineJobId,
        {
          regionId,
          sourceUrl: trackingUrl,
          dataType: source.dataType,
        },
      );

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

      // Hash while the bytes stream past, rather than re-reading a gigabyte
      // from disk afterwards purely to content-address it (#1277).
      //
      // A Transform, not a PassThrough with a "data" listener: attaching that
      // listener switches the stream into flowing mode and consumes chunks
      // before pipeline() has wired them to the write stream, which silently
      // produces an empty file.
      const digest = createHash("sha256");
      const hashStream = new Transform({
        transform(chunk, _encoding, callback) {
          digest.update(chunk);
          callback(null, chunk);
        },
      });

      await pipeline(bodyStream, hashStream, createWriteStream(tmpPath));
      const contentHash = digest.digest("hex");

      const fileSize = (await stat(tmpPath)).size;
      this.logger.log(
        `Downloaded ${(fileSize / 1024 / 1024).toFixed(1)}MB to temp file`,
      );

      // Archived before ingest, not after. The export is worth retaining
      // whether or not parsing it succeeds — a run that failed partway is
      // exactly the case where someone needs the bytes that caused it
      // (#991, #992). The temp file is deleted in the finally below, so this
      // is the only window in which it can be read.
      await this.archiveSnapshot({
        contentHash,
        sourceUrl: source.url,
        byteSize: fileSize,
        fetchedAt: new Date().toISOString(),
        // Optional metadata, read defensively: a missing or unusual header
        // must not fail an ingest measured in tens of hours.
        contentType: response.headers?.get("content-type") ?? undefined,
        regionId,
        dataType: source.dataType,
        ...(session.executionId && { executionId: session.executionId }),
        openStream: () => createReadStream(tmpPath),
      });

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
        const batchSize = bulk.batchSize ?? DEFAULT_BATCH_SIZE;
        let totalItems = 0;

        // On retry, the session exposes already-applied batch indexes so we
        // skip re-sending them to onBatch. Disabled sessions are silent.
        //
        // The resume session is keyed by (job, sourceUrl) and `batchIndex`
        // restarts at 0 for each source, so the tracked identity must be
        // unique per source. See sessionSourceKey for why url + filePattern
        // alone is insufficient (#950, #984).
        let batchIndex = 0;
        let streamSuccess = false;

        try {
          await this.parseDelimitedStream(
            contentStream,
            bulk,
            source,
            async (rawBatch) => {
              const currentBatch = batchIndex++;
              const items = mapBatchItems<T>(
                rawBatch,
                source,
                this.mapper,
                warnings,
              );

              if (items.length === 0) return;

              if (session.appliedBatches.has(currentBatch)) {
                this.logger.debug(
                  `Skipping already-applied batch ${currentBatch} for ${trackingUrl}`,
                );
                return;
              }

              // onBatch (upsert) runs before recordBatch intentionally:
              // if recordBatch fails transiently, the upsert is idempotent
              // and the batch will be re-applied on retry — acceptable.
              //
              // Items are stamped with the producing run here rather than in
              // the pipeline's trackRun, because batch-mode items never
              // appear in the returned result — they reach the persistence
              // layer only through this callback (#1280).
              // Always stamped, null included. An omitted key leaves whatever
              // the previous run wrote, so a row rewritten by an untracked run
              // would keep pointing at the last tracked one — a stale
              // reference that reads as current.
              await onBatch(
                items.map((item) =>
                  item && typeof item === "object"
                    ? {
                        ...item,
                        pipelineExecutionId: session.executionId ?? null,
                      }
                    : item,
                ),
              );
              totalItems += items.length;

              await session.recordBatch(currentBatch, items.length);
            },
            batchSize,
          );
          streamSuccess = true;
        } finally {
          await session.finalize(streamSuccess, {
            itemsExtracted: totalItems,
            itemsFailed: 0,
            extractionTimeMs: Date.now() - pipelineStart,
          });
        }

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

      return mapAndReturn<T>(
        rawRecords,
        warnings,
        errors,
        source,
        this.mapper,
        pipelineStart,
      );
    } catch (error) {
      // Finalize here too. The session now opens before the download (#1277),
      // so a failure that happens before streaming starts — an HTTP error, an
      // empty body, a dead connection — would otherwise leave the execution
      // row stuck at status "running" forever. Nothing reaps those, and a row
      // that never finishes is indistinguishable from a run still in flight.
      await session.finalize(false, {
        itemsExtracted: 0,
        itemsFailed: 1,
        extractionTimeMs: Date.now() - pipelineStart,
      });
      return buildFailureResult<T>(error, warnings, errors, pipelineStart);
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
    // Presence is guaranteed by the up-front guard in execute().
    const mappings = bulk.columnMappings!;
    const filters = bulk.filters ?? {};
    const compositeKey = bulk.compositeKey ?? [];
    const sourceSystem = inferSourceSystem(source);
    const headerSkip = bulk.headerLines ?? 0;

    let lineNum = 0;
    let colIndices: Record<string, number> = {};
    let filterIndices: Record<string, number> = {};
    let compositeIndices: number[] = [];

    const hasExplicitHeaders = bulk.headers && bulk.headers.length > 0;
    if (hasExplicitHeaders) {
      const headers = bulk.headers!;
      colIndices = this.buildColumnIndices(headers, mappings);
      filterIndices = this.buildColumnIndices(headers, filters);
      compositeIndices = this.buildCompositeIndices(headers, compositeKey);
    }

    const headerLineNum = headerSkip;
    const buildIndices = this.buildColumnIndices.bind(this);
    const buildComposite = this.buildCompositeIndices.bind(this);
    const processData = this.processDataLine.bind(this);

    const context = (): ParseContext => ({
      delimiter,
      mappings,
      filters,
      colIndices,
      filterIndices,
      compositeIndices,
      sourceSystem,
    });

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
          compositeIndices = buildComposite(headers, compositeKey);
          lineNum++;
          return null;
        }

        lineNum++;
        const record = processData(line, context());

        // Hash the line, not the parsed record (#1277). The hash has to
        // witness what the export said rather than our interpretation of it —
        // that is what lets a discrepancy be audited after the fact (#991,
        // #992) instead of re-argued. Stamped here rather than at the two
        // parse call sites so streaming and accumulation cannot diverge.
        //
        // Filtered-out lines return null and are not hashed: nothing was
        // ingested, so there is no row whose provenance it would describe.
        return record === null
          ? null
          : { ...record, sourceRecordHash: hashSourceRecord(line) };
      },
    };
  }

  /**
   * Process a single data line: split, filter, map, inject sourceSystem.
   * Returns null if the line should be skipped.
   */
  private processDataLine(
    line: string,
    ctx: ParseContext,
  ): Record<string, unknown> | null {
    if (!line.trim()) return null;

    const { compositeIndices, sourceSystem } = ctx;
    const values = line.split(ctx.delimiter);

    if (!this.passesFilters(values, ctx.filters, ctx.filterIndices))
      return null;

    const record = this.mapRow(values, ctx.mappings, ctx.colIndices);

    if (compositeIndices.length > 0) {
      const segments = compositeIndices.map((idx) =>
        BulkDownloadHandler.stripQuotes(values[idx] ?? ""),
      );
      // An all-empty key identifies nothing and would collide with every other
      // all-empty row, so drop the line rather than upserting them onto each other.
      if (segments.every((s) => !s)) return null;
      // Overwrites any externalId from columnMappings — a feed that needs a
      // composite key by definition has no single column that identifies a row.
      record["externalId"] = segments.join(COMPOSITE_KEY_SEPARATOR);
    }

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
   * Sanitize a CSV/TSV cell value: strip embedded NUL bytes (U+0000),
   * surrounding double quotes, and surrounding whitespace.
   *
   * NUL bytes appear in CalAccess TSVs (notably in committee names and
   * descriptions) and Postgres rejects them in UTF-8 text columns with
   * SQLSTATE 22021 ("invalid byte sequence for encoding UTF8: 0x00"),
   * which fails the entire batch transaction. We drop them here at the
   * parse layer so every downstream consumer (mapper, upsert, linker)
   * sees clean strings.
   */
  private static stripQuotes(val: string): string {
    return val
      .replaceAll("\u0000", "")
      .trim()
      .replaceAll(/(^"|"$)/g, "");
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
        // Same reasoning as buildCompositeIndices: when the first line isn't
        // actually a header row it holds donor data, so log its shape, not its
        // cells (#980 review).
        this.logger.warn(
          `Column '${col}' not found in file headers (${headers.length} column(s) present).`,
        );
      } else {
        indices[col] = idx;
      }
    }
    return indices;
  }

  /**
   * Resolve `compositeKey` column names to their positions, in the order given.
   *
   * Throws on an unresolvable column instead of warning-and-continuing the way
   * {@link buildColumnIndices} does. A missing mapped column costs one field;
   * a missing key component silently shortens the key for *every* row, so
   * distinct rows collapse onto one `externalId` and the upsert discards all
   * but the last. That is the failure this feature exists to prevent
   * (opuspopuli#980), so it must be loud.
   */
  private buildCompositeIndices(
    headers: string[],
    compositeKey: string[],
  ): number[] {
    const missing = compositeKey.filter((col) => !headers.includes(col));
    if (missing.length > 0) {
      // Report the shape of the header row, never its contents. `headers` is
      // just the file's first non-skipped line — and this error fires precisely
      // when that line ISN'T a header row, i.e. when it is a data row. Echoing
      // its cells would put donor name/employer/city/ZIP into an error-level log
      // that propagates to the persisted pipeline errors[] and on to Loki.
      throw new Error(
        `compositeKey column(s) not found in file headers: ${missing.join(", ")}. ` +
          `Header row has ${headers.length} column(s); ` +
          `expected columns are configured in the region plugin.`,
      );
    }
    return compositeKey.map((col) => headers.indexOf(col));
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
}
