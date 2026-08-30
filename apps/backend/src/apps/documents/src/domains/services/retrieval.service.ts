import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { EMBEDDING_DIMENSIONS } from '@opuspopuli/common';
import { MetricsService } from 'src/common/metrics';

/**
 * Matches a scanned petition to the filed measure it actually is (#1074).
 *
 * Replaces the case-insensitive substring search in `linking.service.ts`, which
 * writes a hardcoded `confidence: 0.8` onto every link. Nothing downstream ever
 * depended on that number being right, which is exactly why a constant could
 * sit there unnoticed.
 *
 * Reads `propositions`, which the `region` service owns. That crosses a bounded
 * context, and it is done here only because `linking.service.ts` already does
 * it three times over and splitting the pattern would be worse than following
 * it. Worth revisiting as one piece rather than diverging now.
 */

/**
 * Below this OCR confidence, retrieval is not attempted at all.
 *
 * Measured 2026-08-29 across nine photographs of a printed petition run through
 * the shipped capture path (#1074 subtask 1). Recovery is bimodal and OCR
 * confidence separates it cleanly:
 *
 *   confidence 80-81 → 94%, 91% real words, full title recovered
 *   confidence 72    → 63% real words, title recovered
 *   confidence 31-47 → 0-44% real words
 *
 * Matching noise against the corpus does not fail loudly — it returns the
 * nearest of 52 vectors with a plausible-looking score. A similarity threshold
 * alone cannot tell a weak genuine match from a confident match on garbage,
 * which is why this gate exists upstream of it.
 */
export const MIN_RETRIEVAL_OCR_CONFIDENCE = 70;

/**
 * Cosine similarity at or above which a match is called `verified`.
 *
 * ── Measured, 2026-08-29 (#1074 subtask 7) ───────────────────────────────
 *
 * Nine photographs of a known petition (25-0007A1), their OCR text embedded by
 * the real provider and matched against all 52 filed measures in pgvector:
 *
 *   IMG_0633  conf 80  ->  25-0007A1  0.586   CORRECT
 *   IMG_0629  conf 81  ->  25-0007A1  0.545   CORRECT
 *   IMG_0637  conf 72  ->  24-0001A2  0.414   wrong
 *   IMG_0634  conf 47  ->  25-0019A1  0.317   wrong
 *   others    conf<40  ->  ACA 21/13  0.08-0.24
 *   negative control: a recipe 0.064, a pangram 0.152
 *
 * 0.50 sits in the gap between the worst correct match (0.545) and the best
 * incorrect one (0.414). On this sample it verifies both recoverable
 * photographs and rejects every wrong match, including IMG_0637 — which passed
 * the OCR-confidence gate at 72 and still matched the wrong measure. The two
 * gates compose: confidence filters noise, similarity filters wrong answers.
 *
 * This value was 0.82 before it was measured, chosen by judgement. Nothing
 * would EVER have been verified, and nothing would have reported that — the
 * feature would have shipped permanently dark. That is what the histogram in
 * `recordPetitionRetrieval` is for.
 *
 * ── What was rejected ────────────────────────────────────────────────────
 *
 * Requiring a margin over the runner-up was considered and does not work here:
 * the correct matches beat their runners-up by only 0.026 and 0.050, because
 * the corpus is 52 California ballot measures written in near-identical
 * legalese. A margin rule tight enough to mean anything rejects correct
 * answers.
 *
 * ── Evidence weight ──────────────────────────────────────────────────────
 *
 * Two positive examples, one petition, one photographer. Enough to correct an
 * order-of-magnitude error and place a defensible boundary; not enough to
 * consider settled. Below the threshold a scan falls back to `unverified`,
 * which is a safe landing place rather than a refusal — so the cost of setting
 * this slightly high is a missed label, and of setting it low is a confident
 * analysis of the wrong filing, which is worse. It errs high on purpose.
 */
export const MIN_VERIFIED_SIMILARITY = 0.5;

const SERVICE = 'documents-service';

export interface RetrievalMatch {
  readonly propositionId: string;
  readonly externalId: string;
  readonly title: string;
  /** Cosine similarity in 0..1. */
  readonly similarity: number;
  readonly verified: boolean;
}

export interface RetrievalOutcome {
  readonly attempted: boolean;
  readonly match: RetrievalMatch | null;
  /** Present when retrieval was skipped, for telemetry and the verdict. */
  readonly skippedReason?: 'low_ocr_confidence' | 'no_text' | 'empty_corpus';
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    private readonly embeddings: EmbeddingsService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Embed the scan and find its closest filed measure.
   *
   * Never throws. Retrieval is an enrichment: if it fails, the scan should
   * still be analyzed and labelled `unverified`, not lost.
   */
  async findBestMatch(
    documentId: string,
    text: string,
    ocrConfidence: number | null,
  ): Promise<RetrievalOutcome> {
    if (!text?.trim()) {
      this.metrics.recordPetitionRetrieval(SERVICE, 'skipped_no_text');
      return { attempted: false, match: null, skippedReason: 'no_text' };
    }

    // A null confidence means the extraction path did not record one (PDF and
    // plain-text uploads are deterministic). Those are trustworthy, so only an
    // explicitly low number skips.
    if (
      typeof ocrConfidence === 'number' &&
      ocrConfidence < MIN_RETRIEVAL_OCR_CONFIDENCE
    ) {
      this.logger.log(
        `Retrieval skipped for document ${documentId}: ocrConfidence ${ocrConfidence.toFixed(1)} below ${MIN_RETRIEVAL_OCR_CONFIDENCE}`,
      );
      this.metrics.recordPetitionRetrieval(
        SERVICE,
        'skipped_low_ocr_confidence',
      );
      return {
        attempted: false,
        match: null,
        skippedReason: 'low_ocr_confidence',
      };
    }

    try {
      const vector = await this.embeddings.getEmbeddingsForQuery(text);
      if (
        !Array.isArray(vector) ||
        vector.length !== EMBEDDING_DIMENSIONS ||
        !vector.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw new Error(
          `Embedding provider returned an unusable vector (${vector?.length ?? 'none'} dims)`,
        );
      }

      const literal = `[${vector.join(',')}]`;

      // Store the scan's own vector on the document rather than through
      // IVectorDBProvider. That provider persists `content` alongside every
      // vector, which would create a second at-rest copy of user text — the
      // column exists precisely so it does not have to.
      await this.db.$executeRaw`
        UPDATE documents SET embedding = ${literal}::vector WHERE id = ${documentId}
      `;

      const rows = await this.db.$queryRaw<
        { id: string; external_id: string; title: string; distance: number }[]
      >`
        SELECT id, external_id, title, (embedding <=> ${literal}::vector) AS distance
        FROM propositions
        WHERE embedding IS NOT NULL AND deleted_at IS NULL
        ORDER BY distance ASC
        LIMIT 1
      `;

      if (rows.length === 0) {
        this.metrics.recordPetitionRetrieval(SERVICE, 'skipped_empty_corpus');
        return { attempted: true, match: null, skippedReason: 'empty_corpus' };
      }

      const top = rows[0];
      // pgvector's <=> is cosine DISTANCE; similarity is its complement.
      const similarity = 1 - Number(top.distance);
      const verified = similarity >= MIN_VERIFIED_SIMILARITY;

      // Ids and scores only — never the candidate's text or the scan's.
      this.logger.log(
        `Retrieval for document ${documentId}: best=${top.external_id} similarity=${similarity.toFixed(4)} verified=${verified}`,
      );

      this.metrics.recordPetitionRetrieval(
        SERVICE,
        verified ? 'verified' : 'unverified',
        similarity,
      );

      return {
        attempted: true,
        match: {
          propositionId: top.id,
          externalId: top.external_id,
          title: top.title,
          similarity,
          verified,
        },
      };
    } catch (error) {
      // Enrichment, not a gate. A retrieval outage must degrade to
      // `unverified`, never to a lost scan.
      this.logger.warn(
        `Retrieval failed for document ${documentId} (continuing unverified): ${error}`,
      );
      this.metrics.recordPetitionRetrieval(SERVICE, 'failed');
      return { attempted: true, match: null };
    }
  }
}
