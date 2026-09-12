import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DbService,
  LinkSource,
  assertVectorColumnWidth,
} from '@opuspopuli/relationaldb-provider';
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

/**
 * The model `MIN_VERIFIED_SIMILARITY` was calibrated against, and the evidence.
 *
 * A similarity threshold is not a property of the task — it is a property of
 * one model's similarity space, and the spaces are not comparable. Measured on
 * the same four-document control corpus (2026-09-11):
 *
 *                        correct match   best WRONG match   unfiled scan
 *   MiniLM-384 (this)        0.9703           0.3876           0.3876
 *   bge-base-768             0.9723           0.6951           0.7577
 *
 * Under bge, 0.50 separates nothing: a well-formed initiative that was never
 * filed scores 0.7577 against an unrelated measure and would be labelled
 * `verified`, with an `auto_retrieval` link written to say so. Under nomic —
 * what production runs — correct matches score 0.4–0.5 (#1156), so the same
 * constant is too STRICT and verifies almost nothing. Wrong in both
 * directions, for opposite reasons.
 *
 * So the threshold travels with its model, and a mismatch fails closed.
 */
export const VERIFICATION_CALIBRATION = {
  model: 'Xenova/all-MiniLM-L6-v2',
  threshold: MIN_VERIFIED_SIMILARITY,
  calibratedFrom:
    '9 photographs of a real petition, 2026-08-29 (#1074 subtask 7)',
} as const;

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
  /**
   * True when a match was found but could not be verified because the running
   * embedding model is not the one the threshold was calibrated against.
   *
   * Distinct from an ordinary low-similarity result: that is a judgement the
   * system is entitled to make, this is one it is not.
   */
  readonly uncalibrated?: boolean;
}

/** Which of the three retrieval verdicts telemetry should record. */
function resolveRetrievalOutcome(
  calibrated: boolean,
  verified: boolean,
): 'verified' | 'unverified' | 'uncalibrated' {
  if (!calibrated) return 'uncalibrated';
  return verified ? 'verified' : 'unverified';
}

@Injectable()
export class RetrievalService implements OnModuleInit {
  private readonly logger = new Logger(RetrievalService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    private readonly embeddings: EmbeddingsService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Both columns this service touches, checked at boot.
   *
   * It writes `documents.embedding` and compares against
   * `propositions.embedding`, so a width disagreement on EITHER makes every
   * scan fail — the write with `expected N dimensions`, the query with
   * `different vector dimensions`. Both are caught per-request today and
   * degrade the scan to `unverified`, which is indistinguishable from a
   * genuine low-similarity result. Boot is where that should be found.
   */
  async onModuleInit(): Promise<void> {
    const actual = this.embeddings.getProviderInfo().dimensions;
    if (actual !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embeddings provider produces ${actual}-dimension vectors but the ` +
          `embedding columns are vector(${EMBEDDING_DIMENSIONS}). See ` +
          `EMBEDDING_DIMENSIONS in @opuspopuli/common.`,
      );
    }

    for (const table of ['documents', 'propositions']) {
      await assertVectorColumnWidth(
        this.db,
        table,
        'embedding',
        EMBEDDING_DIMENSIONS,
      );
    }
  }

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
        UPDATE documents
        SET embedding = ${literal}::vector,
            embedding_model = ${this.embeddings.getProviderInfo().model}
        WHERE id = ${documentId}
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

      // Fail closed when the threshold does not belong to the running model.
      //
      // 0.50 is MiniLM-384's number. Applied to bge-base's compressed space it
      // verifies a petition that was never filed (0.7577); applied to nomic's
      // lower one it verifies almost nothing. An `unverified` label is a safe
      // landing place — the scan still gets its analysis, just not a claim
      // about WHICH measure it is — and a wrong `verified` is not, because it
      // writes an auto_retrieval link asserting an identity to the citizen who
      // scanned it. Recalibration needs real photographs re-taken (scan images
      // are never persisted, by design), so the honest state until then is
      // "matched, not verified".
      const runningModel = this.embeddings.getProviderInfo().model;
      const calibrated = runningModel === VERIFICATION_CALIBRATION.model;
      const verified = calibrated && similarity >= MIN_VERIFIED_SIMILARITY;

      if (!calibrated) {
        this.logger.warn(
          `Petition verification is uncalibrated: threshold ${MIN_VERIFIED_SIMILARITY} was ` +
            `measured against ${VERIFICATION_CALIBRATION.model} but the running model is ` +
            `${runningModel}. Matches are reported as unverified until the threshold is ` +
            `re-measured (${VERIFICATION_CALIBRATION.calibratedFrom}).`,
        );
      }

      // Ids and scores only — never the candidate's text or the scan's.
      this.logger.log(
        `Retrieval for document ${documentId}: best=${top.external_id} similarity=${similarity.toFixed(4)} verified=${verified}${calibrated ? '' : ' (uncalibrated)'}`,
      );

      // 'uncalibrated' is deliberately not folded into 'unverified': one is a
      // verdict, the other is the absence of one, and a dashboard that cannot
      // tell them apart shows a dark feature as a working one.
      const telemetryOutcome = resolveRetrievalOutcome(calibrated, verified);
      this.metrics.recordPetitionRetrieval(
        SERVICE,
        telemetryOutcome,
        similarity,
      );

      // Record the match as a link so the rest of the product can see it
      // (#1074 Phase B). DocumentProposition already models "this scan is
      // about that measure", and `getLinkedPropositions` is what carries the
      // filing's own analysis onto the scan surface — without this the match
      // exists only inside the analysis JSON and nothing can act on it.
      //
      // Only for a verified match. Linking a below-threshold guess would put a
      // measure's authoritative analysis next to a scan we are not confident
      // is that measure, which is the "confident analysis of the wrong filing"
      // failure this whole issue exists to avoid.
      if (verified) {
        await this.linkMatch(documentId, top.id, similarity);
      }

      return {
        attempted: true,
        match: {
          propositionId: top.id,
          externalId: top.external_id,
          title: top.title,
          similarity,
          verified,
        },
        ...(calibrated ? {} : { uncalibrated: true }),
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

  /**
   * Upsert the retrieval link, carrying the measured similarity as confidence.
   *
   * `auto_retrieval`, never `auto_analysis`: the latter's links all carry a
   * hardcoded 0.8 that nothing computed, and merging the two would make a real
   * score indistinguishable from that constant.
   *
   * Failure here is logged and swallowed. The link is an enrichment on top of
   * an analysis that already succeeded; losing it costs a cross-reference,
   * while throwing would cost the scan.
   */
  private async linkMatch(
    documentId: string,
    propositionId: string,
    similarity: number,
  ): Promise<void> {
    try {
      await this.db.documentProposition.upsert({
        where: { documentId_propositionId: { documentId, propositionId } },
        update: {
          confidence: similarity,
          linkSource: LinkSource.auto_retrieval,
        },
        create: {
          documentId,
          propositionId,
          linkSource: LinkSource.auto_retrieval,
          confidence: similarity,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to link document ${documentId} to proposition ${propositionId}: ${error}`,
      );
    }
  }
}
