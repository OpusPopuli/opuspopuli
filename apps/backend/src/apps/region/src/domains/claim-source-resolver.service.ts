import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { resolveEvidenceSpan } from './evidence-span';
import { hashContentBytes } from '@opuspopuli/extraction-provider';

/** Why a claim could not be traced back to stored bytes. */
export type UnresolvedReason =
  | 'claim-not-found'
  | 'no-evidence'
  | 'no-archived-source'
  /**
   * The bytes are archived, but what was extracted from them was never
   * recorded (#1306).
   *
   * Distinct from `source-changed` on purpose. The extraction is not
   * reproducible at read time — HTML runs through an LLM-derived CSS plan,
   * PDFs through pdf-parse — so a missing derivation means the passage cannot
   * be re-derived, NOT that the source moved. Collapsing the two would
   * accuse the source of changing whenever our own record was incomplete.
   */
  | 'no-derived-text'
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
 * ## What the span indexes into is NOT the archived bytes
 *
 * `SourceVersion.content` holds the artifact as fetched — a PDF, or a page of
 * HTML. `Evidence.spanStart`/`spanEnd` index into the text *extracted* from
 * it, which for minutes is pdf-parse output truncated at 256 kB and for
 * propositions is a selector extraction under an LLM-derived plan. Decoding
 * the bytes and slicing them would therefore quote a different document.
 *
 * So the passage comes from `SourceVersion.derivedText` — the string recorded
 * at the upsert that wrote the same characters to the subject row (#1306) —
 * while `content` remains what proves the archive is the artifact it claims
 * to be. Both are checked: the bytes against their content address, and the
 * derivation against the hash the citation was measured with.
 *
 * Until a sync has run under #1306 there is nothing to resolve, and every
 * call returns `no-archived-source`. That is the truth rather than an error,
 * and there is a test asserting it so a green suite cannot imply a working
 * chain.
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

    // The archive is content-addressed; verify it is the artefact it claims to
    // be before trusting anything that came out of it.
    // Prisma hands back a Buffer for a BYTEA column; `Buffer.from` on one
    // copies it, which is a wasted duplicate of an archived page that can run
    // to hundreds of kilobytes.
    const bytes = Buffer.isBuffer(version.content)
      ? version.content
      : Buffer.from(version.content);
    if (hashContentBytes(bytes) !== version.contentHash) {
      this.logger.error(
        `SourceVersion ${version.id} does not match its own content hash`,
      );
      return { resolved: false, reason: 'source-changed' };
    }

    // The extracted text, not the decoded bytes. Slicing `decodeUtf8(bytes)`
    // would index a PDF's binary or a page's markup with offsets measured
    // against the text pulled out of it — and the hash comparison below would
    // then fail on every claim, reporting a source change that never happened.
    if (version.derivedText === null) {
      return { resolved: false, reason: 'no-derived-text' };
    }
    const derived = version.derivedText;

    // Hash the stored derivation and compare that against what the citation
    // was checked against. Passing the stored hash as both sides would make
    // the two always agree and the staleness check inert — the exact mistake
    // #1293 made in the dual-write path, caught there by a test and here by
    // another.
    const derivedHash = createHash('sha256')
      .update(derived, 'utf8')
      .digest('hex');

    if (
      version.derivedTextHash !== null &&
      version.derivedTextHash !== derivedHash
    ) {
      // The column and its own hash disagree, which means the row was altered
      // outside the write-once path. Trusting either half would be a guess.
      this.logger.error(
        `SourceVersion ${version.id} derived text does not match its ` +
          `recorded hash`,
      );
      return { resolved: false, reason: 'source-changed' };
    }

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
