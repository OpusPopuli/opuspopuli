import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { FetchProvenance } from '@opuspopuli/extraction-provider';

/**
 * Largest body we will archive, in bytes.
 *
 * There is no size cap anywhere on the fetch path — a hostile or merely
 * misconfigured source can return an arbitrarily large body, and until now
 * that only cost transient memory. Writing it to Postgres makes it permanent:
 * the store is append-only, so a single 2 GB response is 2 GB that nothing
 * short of a migration removes, in a table sized on the expectation of
 * 1–3 GB/yr *total* (#1276).
 *
 * 25 MB clears real civic artifacts comfortably — the largest CAL-ACCESS
 * filings and agenda packets are single-digit MB — while bounding the damage
 * from a bad one. Oversized bodies are skipped, not truncated: half a
 * document under a hash that claims to be the whole thing is worse than no
 * archive at all, because it would verify.
 */
export const MAX_ARCHIVED_BYTES = 25 * 1024 * 1024;

/** What a caller must supply to archive a fetched artifact. */
export interface RecordSourceInput extends FetchProvenance {
  /** Raw bytes exactly as received */
  content: Buffer;
  /** URL that produced them */
  sourceUrl: string;
  /** Response Content-Type, if the server sent one */
  contentType?: string;
  /** Region this fetch belongs to */
  regionId?: string;
  /** Pipeline data type (bills, propositions, minutes, …) */
  dataType?: string;
  /** PipelineExecution that fetched it */
  executionId?: string;
  /** StructuralManifest in force at fetch time */
  manifestId?: string;
}

/** Outcome of an archive attempt. */
export interface RecordSourceResult {
  /** Content address of the bytes */
  contentHash: string;
  /** False when an identical artifact was already stored */
  stored: boolean;
  /** Set when the artifact was rejected rather than stored */
  skippedReason?: 'too-large' | 'empty';
}

/**
 * Append-only, content-addressed store for the sources claims cite (#1276).
 *
 * Identity is the SHA-256 of the raw bytes, computed at the fetch boundary
 * before decoding. Re-fetching unchanged content therefore collides with the
 * row already present and writes nothing, so the table grows with how often
 * sources *change* rather than how often we look at them.
 *
 * Nothing here updates or deletes. `sourceUrl`, `fetchedAt` and the HTTP
 * validators describe the fetch that *first* captured a given set of bytes.
 *
 * The stored bytes are public civic material, but they can contain personal
 * data — proponent contact details are in `Proposition.fullText` (#1263)
 * precisely because they are in the source document. Nothing renders these
 * bytes today; any future read path must redact before display.
 */
@Injectable()
export class SourceVersionService {
  private readonly logger = new Logger(SourceVersionService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Archive a fetched artifact, or recognise that it is already archived.
   *
   * Never throws on a duplicate: two pipeline runs fetching the same unchanged
   * page concurrently is the normal case, not an error, and a sync must not
   * fail because its source was already witnessed.
   *
   * @param input - Bytes plus the provenance captured at fetch time
   * @returns The content address, and whether this call stored it
   */
  async record(input: RecordSourceInput): Promise<RecordSourceResult> {
    const { content, contentHash } = input;

    if (content.length === 0) {
      return { contentHash, stored: false, skippedReason: 'empty' };
    }

    if (content.length > MAX_ARCHIVED_BYTES) {
      this.logger.warn(
        `Not archiving ${input.sourceUrl}: ${content.length} bytes exceeds ` +
          `the ${MAX_ARCHIVED_BYTES}-byte cap`,
      );
      return { contentHash, stored: false, skippedReason: 'too-large' };
    }

    // Cheap path first: the overwhelmingly common outcome is that these exact
    // bytes are already stored, and that costs an index probe rather than
    // shipping the payload to the database to be rejected.
    const existing = await this.db.sourceVersion.findUnique({
      where: { contentHash },
      select: { id: true },
    });

    if (existing) {
      return { contentHash, stored: false };
    }

    try {
      await this.db.sourceVersion.create({
        data: {
          contentHash,
          content,
          byteSize: content.length,
          contentType: input.contentType ?? null,
          sourceUrl: input.sourceUrl,
          fetchedAt: new Date(input.fetchedAt),
          etag: input.etag ?? null,
          lastModified: input.lastModified ?? null,
          regionId: input.regionId ?? null,
          dataType: input.dataType ?? null,
          executionId: input.executionId ?? null,
          manifestId: input.manifestId ?? null,
        },
      });

      return { contentHash, stored: true };
    } catch (error) {
      // A concurrent writer won the race between the probe above and this
      // insert. The row exists and holds identical bytes by definition — the
      // hash is the key — so this is a successful no-op, not a failure.
      if (isUniqueViolation(error)) {
        return { contentHash, stored: false };
      }
      throw error;
    }
  }

  /**
   * Retrieve an archived artifact by its content address.
   *
   * @param contentHash - SHA-256 of the raw bytes, hex-encoded
   * @returns The stored artifact, or null if it was never archived
   */
  async getByHash(contentHash: string) {
    return this.db.sourceVersion.findUnique({ where: { contentHash } });
  }

  /**
   * Provenance for an archived artifact without shipping its bytes.
   *
   * Separate from {@link getByHash} because the payload can be megabytes and
   * the common question — when did we fetch this, what did the server say
   * about it, which run produced it — never needs them.
   *
   * @param contentHash - SHA-256 of the raw bytes, hex-encoded
   * @returns Metadata for the artifact, or null if it was never archived
   */
  async getProvenance(contentHash: string) {
    return this.db.sourceVersion.findUnique({
      where: { contentHash },
      select: {
        id: true,
        contentHash: true,
        byteSize: true,
        contentType: true,
        sourceUrl: true,
        fetchedAt: true,
        etag: true,
        lastModified: true,
        regionId: true,
        dataType: true,
        executionId: true,
        manifestId: true,
        createdAt: true,
      },
    });
  }
}

/** Prisma's unique-constraint error code. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
