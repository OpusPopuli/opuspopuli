import { Injectable, Logger } from '@nestjs/common';
import type {
  ArchiveOutcome,
  ISourceArchive,
} from '@opuspopuli/extraction-provider';
import { SourceVersionService } from '../domains/source-version.service';

/**
 * Binds the extraction layer's SOURCE_ARCHIVE port to the source store (#1276).
 *
 * The port exists so `@opuspopuli/extraction-provider` never learns about the
 * database: it has the raw bytes, this side owns the bounded context that
 * persists them.
 *
 * Deliberately swallows nothing — {@link SourceVersionService.record} already
 * treats a duplicate as success, so anything reaching the catch here is a real
 * storage failure. It is logged rather than rethrown because the provider
 * treats archiving as best-effort alongside the fetch; a scrape must not die
 * because the archive was unavailable.
 */
@Injectable()
export class PrismaSourceArchive implements ISourceArchive {
  private readonly logger = new Logger(PrismaSourceArchive.name);

  constructor(private readonly sourceVersions: SourceVersionService) {}

  async archive(
    input: Parameters<ISourceArchive['archive']>[0],
  ): Promise<ArchiveOutcome> {
    const result = await this.sourceVersions.record({
      content: input.content,
      contentHash: input.contentHash,
      fetchedAt: input.fetchedAt,
      sourceUrl: input.sourceUrl,
      contentType: input.contentType,
      etag: input.etag,
      lastModified: input.lastModified,
      regionId: input.regionId,
      dataType: input.dataType,
      executionId: input.executionId,
      manifestId: input.manifestId,
    });

    if (result.skippedReason) {
      this.logger.warn(
        `Not archived (${result.skippedReason}): ${input.sourceUrl}`,
      );
    }

    // Undefined when the store rejected the body. Returning the content hash
    // instead would hand the caller an identity for bytes nobody kept (#1306).
    return {
      ...(result.sourceVersionId && {
        sourceVersionId: result.sourceVersionId,
      }),
    };
  }
}
