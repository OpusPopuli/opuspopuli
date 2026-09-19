import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IStorageProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type {
  BulkSnapshotCandidate,
  IBulkArchive,
} from '@opuspopuli/scraping-pipeline';

/** Bucket the bulk tier writes to when none is configured. */
export const DEFAULT_ARCHIVE_BUCKET = 'bulk-archives';

/**
 * Binds the pipeline's BULK_ARCHIVE port to object storage plus the
 * `bulk_snapshots` table (#1277).
 *
 * The row is written **whether or not the upload succeeds**, with
 * `storageKey` left null when it did not. Two reasons:
 *
 *  - A finance row's provenance resolves through the snapshot row, not through
 *    its bytes (`row → execution ← snapshot`). Skipping the row on an upload
 *    failure would break the chain for every row in that run.
 *  - Supabase Storage enforces a per-file limit — 50 MB by default — that a
 *    ~1 GB export exceeds. If a deployment is configured that way, the failure
 *    has to be legible in the data rather than only in a log line nobody reads.
 *
 * Re-fetching an unchanged export collides on `contentHash` and stores nothing
 * new, so cost tracks how often the export *changes* rather than how often it
 * is downloaded.
 */
@Injectable()
export class PrismaBulkArchive implements IBulkArchive {
  private readonly logger = new Logger(PrismaBulkArchive.name);
  private readonly bucket: string;

  constructor(
    private readonly db: DbService,
    @Optional()
    @Inject('STORAGE_PROVIDER')
    private readonly storage: IStorageProvider | null,
    configService: ConfigService,
  ) {
    this.bucket =
      configService.get<string>('storage.archiveBucket') ??
      DEFAULT_ARCHIVE_BUCKET;
  }

  async archive(candidate: BulkSnapshotCandidate): Promise<void> {
    const existing = await this.db.bulkSnapshot.findUnique({
      where: { contentHash: candidate.contentHash },
      select: { id: true },
    });

    if (existing) {
      this.logger.debug(
        `Bulk export unchanged, already archived: ${candidate.sourceUrl}`,
      );
      return;
    }

    const storageKey = this.keyFor(candidate);
    const stored = await this.upload(candidate, storageKey);

    await this.db.bulkSnapshot.create({
      data: {
        contentHash: candidate.contentHash,
        sourceUrl: candidate.sourceUrl,
        byteSize: BigInt(candidate.byteSize),
        contentType: candidate.contentType ?? null,
        fetchedAt: new Date(candidate.fetchedAt),
        regionId: candidate.regionId ?? null,
        dataType: candidate.dataType ?? null,
        executionId: candidate.executionId ?? null,
        storageBucket: stored ? this.bucket : null,
        storageKey: stored ? storageKey : null,
      },
    });
  }

  /**
   * Content-addressed key, sharded on the first byte of the hash.
   *
   * A flat prefix would put every snapshot this project ever takes in one
   * listing; the shard keeps `listFiles` usable without needing an index.
   */
  private keyFor(candidate: BulkSnapshotCandidate): string {
    const hash = candidate.contentHash;
    return `bulk/${hash.slice(0, 2)}/${hash}`;
  }

  /**
   * Upload the payload. Returns whether the bytes actually landed.
   *
   * Never throws: the caller must still record the snapshot, and the pipeline
   * treats archiving as best-effort alongside an ingest that has already
   * succeeded.
   */
  private async upload(
    candidate: BulkSnapshotCandidate,
    storageKey: string,
  ): Promise<boolean> {
    if (!this.storage?.putStream) {
      this.logger.warn(
        `No storage provider able to accept a server-side upload — ` +
          `recording ${candidate.sourceUrl} without its bytes`,
      );
      return false;
    }

    try {
      await this.storage.putStream(
        this.bucket,
        storageKey,
        candidate.openStream,
        {
          contentLength: candidate.byteSize,
          ...(candidate.contentType && { contentType: candidate.contentType }),
        },
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to upload bulk snapshot ${storageKey}: ` +
          `${(error as Error).message}`,
      );
      return false;
    }
  }
}
