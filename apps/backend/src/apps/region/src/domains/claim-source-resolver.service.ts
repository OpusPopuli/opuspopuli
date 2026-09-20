import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { resolveEvidenceSpan } from './evidence-span';
import { decodeUtf8, hashContentBytes } from '@opuspopuli/extraction-provider';

/** Why a claim could not be traced back to stored bytes. */
export type UnresolvedReason =
  | 'claim-not-found'
  | 'no-evidence'
  | 'no-archived-source'
  | 'source-changed'
  | 'span-unusable';

/** A claim traced all the way to the bytes that were fetched. */
export interface ResolvedClaimSource {
  resolved: true;
  claimText: string;
  /**
   * True when this claim has been superseded by a later generation (#1295).
   *
   * Superseded claims still resolve, deliberately — tracing what was asserted
   * about a measure last month is the reason supersession exists rather than
   * deletion. Flagged so a caller cannot present a retired assertion as
   * current.
   */
  superseded: boolean;
  /** The passage, re-derived from the archived bytes at read time. */
  passage: string;
  sourceUrl: string;
  fetchedAt: Date;
  /** SHA-256 of the raw bytes as fetched — the content-addressed identity. */
  contentHash: string;
}

export interface UnresolvedClaimSource {
  resolved: false;
  reason: UnresolvedReason;
}

export type ClaimSourceResult = ResolvedClaimSource | UnresolvedClaimSource;

/**
 * Trace a claim to the exact stored bytes it rests on (#1296, #1208).
 *
 * claim → evidence → `SourceVersion` → the passage, **re-derived at read
 * time** rather than served from a stored copy. Storing the passage would
 * make it a second source of truth that could drift from the bytes; deriving
 * it means the archive is the only thing that has to be trusted.
 *
 * ## This is inert on real data today, and that is not hidden
 *
 * `Evidence.sourceVersionId` is never populated. Measured 2026-09-20:
 * `source_versions` holds **0 rows** and `propositions.pipeline_execution_id`
 * is NULL on every row — #1276 built the store and #1280 built row provenance,
 * but no sync has run since either landed.
 *
 * Carrying the id from the archive write through the pipeline onto the subject
 * row is a chain across four packages and is filed separately;
 * `ISourceArchive.archive()` returns `void` today, so the id is not even
 * available to propagate. **This is the consuming half**, built first so the
 * producer has a defined thing to satisfy. Until then every call returns
 * `no-archived-source`, which is the truth rather than an error.
 */
@Injectable()
export class ClaimSourceResolverService {
  private readonly logger = new Logger(ClaimSourceResolverService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Resolve one claim down to the passage in the archived bytes.
   *
   * @param claimId - The claim to trace
   * @returns The passage and the fetch that produced it, or why it could not be traced
   */
  async resolve(claimId: string): Promise<ClaimSourceResult> {
    const claim = await this.db.claim.findUnique({
      where: { id: claimId },
      include: { evidence: { include: { evidence: true } } },
    });

    if (!claim) return { resolved: false, reason: 'claim-not-found' };
    if (claim.evidence.length === 0) {
      return { resolved: false, reason: 'no-evidence' };
    }

    // The evidence that actually carries an archived source. A claim can hold
    // several citations and only some be traceable.
    const link = claim.evidence.find((e) => e.evidence.sourceVersionId);
    if (!link) return { resolved: false, reason: 'no-archived-source' };

    const evidence = link.evidence;
    const version = await this.db.sourceVersion.findUnique({
      where: { id: evidence.sourceVersionId! },
    });
    if (!version) return { resolved: false, reason: 'no-archived-source' };

    // Decoded with the same function the fetch path used before hashing
    // (#1276). A second decoder would drift, and the check below would start
    // failing for no visible reason.
    // Prisma hands back a Buffer for a BYTEA column; `Buffer.from` on one
    // copies it, which is a wasted duplicate of an archived page that can run
    // to hundreds of kilobytes.
    const bytes = Buffer.isBuffer(version.content)
      ? version.content
      : Buffer.from(version.content);
    const derived = decodeUtf8(bytes);

    // The archive is content-addressed; verify it is the artefact it claims to
    // be before trusting anything sliced out of it.
    if (hashContentBytes(bytes) !== version.contentHash) {
      this.logger.error(
        `SourceVersion ${version.id} does not match its own content hash`,
      );
      return { resolved: false, reason: 'source-changed' };
    }

    // Hash what the bytes ACTUALLY decoded to, and compare that against what
    // the citation was checked against. Passing the stored hash as both sides
    // would make the two always agree and the staleness check inert — the
    // exact mistake #1293 made in the dual-write path, caught there by a test
    // and here by another.
    const derivedHash = createHash('sha256')
      .update(derived, 'utf8')
      .digest('hex');

    const span = resolveEvidenceSpan(derived, derivedHash, {
      sourceTextHash: evidence.sourceTextHash,
      spanStart: evidence.spanStart,
      spanEnd: evidence.spanEnd,
    });

    if (span.status === 'stale') {
      // The derived text moved under the citation. Returning the characters
      // at those offsets anyway would quote the source as saying something it
      // may never have said.
      return { resolved: false, reason: 'source-changed' };
    }
    if (span.status !== 'resolved') {
      return { resolved: false, reason: 'span-unusable' };
    }

    return {
      resolved: true,
      claimText: claim.text,
      superseded: claim.validUntil !== null,
      passage: span.text,
      sourceUrl: version.sourceUrl,
      fetchedAt: version.fetchedAt,
      contentHash: version.contentHash,
    };
  }
}
