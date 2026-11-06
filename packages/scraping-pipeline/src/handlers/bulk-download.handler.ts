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
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type {
  BulkSnapshotCandidate,
  IBulkArchive,
} from "./bulk-archive.port.js";
import type { IBulkImportLedger } from "./bulk-import-ledger.port.js";
import { bulkImportKey } from "./bulk-import-key.js";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import yauzl from "yauzl";
import type {
  BulkBatchContext,
  BulkDownloadConfig,
  BulkDownloadScope,
  DataSourceConfig,
  ExtractionResult,
  ScopedDownload,
} from "@opuspopuli/common";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";
import { createLineParser } from "./bulk-line-parser.js";
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

/** Temp exports are named with this prefix, and swept by it. */
const TEMP_PREFIX = "opus-bulk-";

/**
 * A temp export older than this is left over from a worker that was killed
 * (an OOM, a container stop) before it could delete it, and is removed before
 * the next download. One sync holds its export for its whole run, ten hours
 * at most so far, so this sits well clear of any live file.
 */
const STALE_EXPORT_MS = 48 * 60 * 60 * 1000;

/**
 * Delete temp exports a killed worker left behind. An export carries the
 * whole file, donor names and addresses included, so one must not sit in the
 * temp directory indefinitely. Never throws: a sweep that fails must not stop
 * the download.
 */
async function removeStaleExports(dir: string, now: number): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((n) => n.startsWith(TEMP_PREFIX) && n.endsWith(".tmp"))
      .map(async (n) => {
        const path = join(dir, n);
        const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: now }));
        if (now - mtimeMs > STALE_EXPORT_MS) {
          await unlink(path).catch(() => undefined);
        }
      }),
  );
}

/** Default batch size for record processing (trades memory for fewer DB round-trips) */
const DEFAULT_BATCH_SIZE = 10_000;

/** An export on local disk, deleted by `release` (D4: maybe shared). */
interface DownloadedExport extends ScopedDownload {
  path: string;
  /** Its `bulk_snapshots` row, when the archive recorded one (D5). */
  snapshotId?: string;
}

/**
 * Callback invoked with each batch of mapped domain objects, and whether
 * unchanged rows in it may be skipped (D1, D3).
 */
export type OnBatchCallback<T> = (
  items: T[],
  context: BulkBatchContext,
) => Promise<void>;

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
    /** The shared per-host rate limit (S1); see ApiIngestHandler. */
    private readonly hostSlot: ((url: string) => Promise<void>) | null = null,
    /**
     * Records which imports completed (D3). Optional: left unbound, nothing
     * is ever skipped and every row is written, as before K4.
     */
    private readonly importLedger: IBulkImportLedger | null = null,
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
  ): Promise<string | undefined> {
    if (!this.bulkArchive) return undefined;

    try {
      return await this.bulkArchive.archive(candidate);
    } catch (error) {
      this.logger.warn(
        `Failed to archive ${candidate.sourceUrl}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /** Never throws: a lost record only costs the next sync its skip. */
  private async recordImportCompleted(
    sourceKey: string,
    importKey: string,
    executionId: string | null,
  ): Promise<void> {
    try {
      await this.importLedger?.recordCompleted(
        sourceKey,
        importKey,
        executionId,
      );
    } catch (error) {
      this.logger.warn(
        `Could not record the completed import of ${sourceKey}: ${(error as Error).name}`,
      );
    }
  }

  /**
   * Whether this source's rows may be skipped when unchanged: only when its
   * last completed import ran under the key this one runs under (D3). Never
   * throws; anything unreadable means "write every row".
   *
   * On any other answer the entry is forgotten before the first batch. This
   * run is about to rewrite rows under its own key, and if it dies partway an
   * entry left standing would let a run under the old key skip them.
   */
  private async maySkipUnchanged(
    sourceKey: string,
    importKey: string,
  ): Promise<boolean> {
    if (!this.importLedger) return false;
    try {
      if ((await this.importLedger.lastCompletedKey(sourceKey)) === importKey) {
        return true;
      }
      await this.importLedger.forget(sourceKey);
    } catch (error) {
      this.logger.warn(
        `Could not read the import ledger for ${sourceKey}: ${(error as Error).name}`,
      );
    }
    return false;
  }

  async execute<T>(
    source: DataSourceConfig,
    regionId: string,
    onBatch?: OnBatchCallback<T>,
    pipelineJobId?: string,
    /**
     * One download per export per sync (`campaign-finance-phase-b.md`, D4).
     * When set, the export is fetched by the first source that reads it and
     * released by whoever closes the scope; unset, this source downloads its
     * own copy and deletes it when done.
     */
    bulkDownloads?: BulkDownloadScope,
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

    let download: DownloadedExport | undefined;
    try {
      // 1. The export on disk: this sync's shared copy, or this source's own.
      const fetchExport = () =>
        this.downloadExport(source, regionId, session.executionId);
      download = await (bulkDownloads
        ? bulkDownloads.acquire(source.url, fetchExport)
        : fetchExport());
      // Every source that read this export points at it, not only the one
      // that downloaded it (D5).
      if (download.snapshotId) await session.linkSnapshot(download.snapshotId);

      // 2. Get a readable stream for the target content
      let contentStream: Readable;
      const isZip = bulk.format.startsWith("zip_");

      if (isZip) {
        contentStream = await this.extractZipEntryStream(download.path, bulk);
      } else {
        contentStream = createReadStream(download.path, { encoding: "utf-8" });
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
        const importKey = bulkImportKey(source);
        const context: BulkBatchContext = {
          skipUnchanged: await this.maySkipUnchanged(trackingUrl, importKey),
        };

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
                context,
              );
              totalItems += items.length;

              await session.recordBatch(currentBatch, items.length);
            },
            batchSize,
          );
          streamSuccess = true;
          // A resumed run skipped batches an earlier attempt wrote, perhaps
          // under another key (a deploy between attempts), so it cannot vouch
          // for them. The next sync writes every row once instead.
          if (session.appliedBatches.size === 0) {
            await this.recordImportCompleted(
              trackingUrl,
              importKey,
              session.executionId,
            );
          }
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
      // A shared download is the scope's to release, once every source has
      // read it.
      if (!bulkDownloads) await download?.release();
    }
  }

  /**
   * Stream an export to a temp file, hashing it on the way, and offer it to
   * the bulk archive. Deletes the file itself if anything here fails.
   */
  private async downloadExport(
    source: DataSourceConfig,
    regionId: string,
    executionId: string | null | undefined,
  ): Promise<DownloadedExport> {
    await removeStaleExports(tmpdir(), Date.now());
    const tmpPath = join(tmpdir(), `${TEMP_PREFIX}${randomUUID()}.tmp`);
    const release = async (): Promise<void> => {
      await unlink(tmpPath).catch(() => undefined);
    };
    try {
      // 1. Stream download to temp file (no memory buffering)
      this.logger.log(`Downloading ${source.url}...`);
      await this.hostSlot?.(source.url);
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

      // Owner-only: the export holds personal information (donor names,
      // employers, ZIPs), and the default mode leaves it world-readable.
      await pipeline(
        bodyStream,
        hashStream,
        createWriteStream(tmpPath, { mode: 0o600 }),
      );
      const contentHash = digest.digest("hex");

      const fileSize = (await stat(tmpPath)).size;
      this.logger.log(
        `Downloaded ${(fileSize / 1024 / 1024).toFixed(1)}MB to temp file`,
      );

      // Archived before ingest, not after. The export is worth retaining
      // whether or not parsing it succeeds — a run that failed partway is
      // exactly the case where someone needs the bytes that caused it
      // (#991, #992). The temp file is deleted on release, so this is the
      // only window in which it can be read.
      const snapshotId = await this.archiveSnapshot({
        contentHash,
        sourceUrl: source.url,
        byteSize: fileSize,
        fetchedAt: new Date().toISOString(),
        // Optional metadata, read defensively: a missing or unusual header
        // must not fail an ingest measured in tens of hours.
        contentType: response.headers?.get("content-type") ?? undefined,
        // `last-modified` is the export's own publication date — the
        // provenance #991 shows readers as `asOfSource`. It was never read
        // here, so `bulk_snapshots.last_modified` had been null since the
        // column was added (#1277) and the figure could never be dated. The
        // CDN does send it: `last-modified: Tue, 13 Oct 2026 08:59:20 GMT`.
        lastModified: response.headers?.get("last-modified") ?? undefined,
        etag: response.headers?.get("etag") ?? undefined,
        regionId,
        dataType: source.dataType,
        ...(executionId && { executionId }),
        openStream: () => createReadStream(tmpPath),
      });

      return { path: tmpPath, release, ...(snapshotId && { snapshotId }) };
    } catch (error) {
      await release();
      throw error;
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

    const lineParser = createLineParser(bulk, source);
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

    const lineParser = createLineParser(bulk, source);
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
}
