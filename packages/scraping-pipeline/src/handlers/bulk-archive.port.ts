/**
 * DI token for the optional bulk-snapshot archive (#1277).
 *
 * Left unbound, bulk exports are ingested exactly as before and nothing is
 * retained — the behaviour that held until this issue.
 */
export const BULK_ARCHIVE = "BULK_ARCHIVE";

/** A downloaded bulk export, offered to the archive. */
export interface BulkSnapshotCandidate {
  /** SHA-256 of the downloaded file, hex-encoded */
  contentHash: string;
  /** URL the export came from */
  sourceUrl: string;
  /** Exact size on disk */
  byteSize: number;
  /** When the download completed, ISO 8601 */
  fetchedAt: string;
  /** Response Content-Type, if the server sent one */
  contentType?: string;
  /** Region whose sync fetched it */
  regionId?: string;
  /** Pipeline data type */
  dataType?: string;
  /** PipelineExecution that fetched it (#1280) */
  executionId?: string;
  /**
   * Opens a fresh read stream over the downloaded file.
   *
   * A factory rather than a stream because the file is deleted as soon as
   * ingest finishes: the implementation must read it while this call is still
   * awaited, and may need more than one attempt.
   */
  openStream: () => NodeJS.ReadableStream;
}

/**
 * Durable store for bulk exports — tier 2 of the source store (#1277).
 *
 * An interface rather than a concrete service because `scraping-pipeline` must
 * not learn about the database or about object storage; the implementation
 * lives in the region service, which owns both.
 *
 * Implementations must not throw. Retaining a snapshot is bookkeeping running
 * alongside an ingest that has already succeeded, and a finance sync measured
 * in tens of hours (#1037) must not be failed by an archive that was
 * unavailable.
 */
export interface IBulkArchive {
  archive(candidate: BulkSnapshotCandidate): Promise<void>;
}
