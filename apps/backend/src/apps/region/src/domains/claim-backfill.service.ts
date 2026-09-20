import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type {
  BioClaim,
  MinutesSummaryClaim,
  PropositionAnalysisClaim,
} from '@opuspopuli/common';
import {
  type ClaimRecordInput,
  normaliseAnalysisClaims,
  normaliseBioClaims,
  normaliseSummaryClaims,
} from './claim-normalisers';
import { recordClaims } from './claim-recorder';
import type { VerifiedState } from './evidence-verifier';

/** Rows read per pass. Bounds how much source text is resident at once. */
const BATCH_SIZE = 20;

/** What a backfill run reports. */
export interface ClaimBackfillReport {
  propositions: number;
  minutes: number;
  representatives: number;
  claimsWritten: number;
  /**
   * Rows whose backfill threw and were skipped.
   *
   * Reported because the distribution alone cannot show it: that number is a
   * query over what was stored, so it stays internally consistent and
   * confident-looking even when a third of the corpus never made it in.
   */
  failed: number;
  /** Read back from `evidence.state`, never accumulated while writing. */
  distribution: Record<VerifiedState, number>;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Backfill the three legacy claim shapes through the verify-or-snap gate
 * (#1294).
 *
 * Reuses #1293's normalisers and `recordClaims` rather than mapping again —
 * a second implementation is how the eval harness and the gate drifted before
 * (#1212, #1292), and it would make the two claim corpora disagree.
 *
 * **Expect a large `unverified` population.** 528 of the 1,497 claims are
 * proposition offsets and not one carries a quote, so ~2% of them anchoring is
 * the honest outcome on the contract #1212 measured. Minutes is the family
 * that can genuinely verify: all 218 of its claims quote `rawText` verbatim.
 * A backfill reporting uniformly high success against this corpus would be one
 * that skipped the gate.
 */
@Injectable()
export class ClaimBackfillService {
  private readonly logger = new Logger(ClaimBackfillService.name);

  /** Rows skipped this run, reset at the start of each `backfillAll`. */
  private failed = 0;

  constructor(private readonly db: DbService) {}

  /**
   * Mirror every stored claim into the evidence graph.
   *
   * Idempotent: `recordClaims` replaces a subject's claims rather than
   * appending, so a second run converges on the same rows. Safe to run
   * alongside live generation — the advisory lock serialises the two on any
   * subject they both touch.
   *
   * @param limit - Optional cap on rows per family, for a rehearsal run
   * @returns Counts, plus the verdict distribution read back from the database
   */
  async backfillAll(limit?: number): Promise<ClaimBackfillReport> {
    this.failed = 0;

    const propositions = await this.backfillPropositions(limit);
    const minutes = await this.backfillMinutes(limit);
    const representatives = await this.backfillRepresentatives(limit);

    const distribution = await this.readDistribution();
    const claimsWritten = Object.values(distribution).reduce(
      (a, b) => a + b,
      0,
    );

    const failed = this.failed;
    const summary =
      `Claim backfill complete: ${propositions} propositions, ${minutes} minutes, ` +
      `${representatives} representatives -> ${claimsWritten} claims ` +
      `(${JSON.stringify(distribution)})`;

    if (failed > 0) {
      // At `error`, and said separately: a partial backfill whose only output
      // is a tidy distribution reads exactly like a complete one.
      this.logger.error(
        `${summary} — ${failed} row(s) FAILED and were skipped`,
      );
    } else {
      this.logger.log(summary);
    }

    return {
      propositions,
      minutes,
      representatives,
      claimsWritten,
      failed,
      distribution,
    };
  }

  /**
   * The verdict distribution, as a query over what was actually stored.
   *
   * Read back rather than accumulated while writing, because this issue's
   * acceptance criterion is the gate's measurement — not a summary the
   * backfill wrote about itself. The two diverge the moment a write fails.
   */
  async readDistribution(): Promise<Record<VerifiedState, number>> {
    const rows = await this.db.evidence.groupBy({
      by: ['state'],
      _count: { state: true },
    });

    const distribution: Record<VerifiedState, number> = {
      verified: 0,
      snapped: 0,
      unverified: 0,
      unsourced: 0,
    };
    for (const row of rows) {
      distribution[row.state as VerifiedState] = row._count.state;
    }
    return distribution;
  }

  /**
   * `propositions.analysis_claims` — the offsets corpus.
   *
   * `analysisSourceTextHash` is passed through as the cited version. It is
   * NULL on every existing row, because #1279's column post-dates all of
   * them; the resolver reports `stale` only for a hash that is present AND
   * differs, so a NULL is scored against current text rather than refused.
   * That is deliberate: refusing would leave 528 claims unscored and make the
   * measured anchoring rate unreproducible, which is the one thing this issue
   * exists to deliver. No freshness is claimed either — the claim is scored,
   * and what it scores is what gets recorded.
   */
  private async backfillPropositions(limit?: number): Promise<number> {
    return this.eachBatch(
      limit,
      (afterId, take) =>
        this.db.proposition.findMany({
          where: {
            analysisClaims: { not: Prisma.DbNull },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: {
            id: true,
            fullText: true,
            fullTextHash: true,
            analysisClaims: true,
            analysisSourceTextHash: true,
          },
          orderBy: { id: 'asc' },
          take,
        }),
      (row) => ({
        subjectType: 'proposition',
        subjectId: row.id,
        claims: normaliseAnalysisClaims(
          row.analysisClaims as unknown as PropositionAnalysisClaim[],
        ),
        sourceText: row.fullText,
        sourceTextHash: row.fullTextHash,
        claimSourceTextHash: row.analysisSourceTextHash,
      }),
    );
  }

  /**
   * `minutes.summary_claims` — the only family that quotes verbatim.
   *
   * `Minutes` stores no hash of `rawText` (#1279 covered propositions only),
   * so it is hashed at read time. Quotes locate by search rather than by
   * offset, which is why this family can still verify without a recorded
   * source version.
   */
  private async backfillMinutes(limit?: number): Promise<number> {
    return this.eachBatch(
      limit,
      (afterId, take) =>
        this.db.minutes.findMany({
          where: {
            summaryClaims: { not: Prisma.DbNull },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: { id: true, rawText: true, summaryClaims: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (row) => ({
        subjectType: 'minutes',
        subjectId: row.id,
        claims: normaliseSummaryClaims(
          row.summaryClaims as unknown as MinutesSummaryClaim[],
        ),
        sourceText: row.rawText,
        sourceTextHash: row.rawText ? sha256(row.rawText) : null,
      }),
    );
  }

  /**
   * `representatives.bio_claims` — claims that cite fields, not text.
   *
   * No source text, because there is none to cite into. `origin: 'training'`
   * must survive as `unsourced` rather than being laundered into `unverified`:
   * one is a claim that never offered a citation, the other is a citation that
   * failed a check, and #1208 requires the difference to survive.
   */
  private async backfillRepresentatives(limit?: number): Promise<number> {
    return this.eachBatch(
      limit,
      (afterId, take) =>
        this.db.representative.findMany({
          where: {
            bioClaims: { not: Prisma.DbNull },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: { id: true, bioClaims: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (row) => ({
        subjectType: 'representative',
        subjectId: row.id,
        claims: normaliseBioClaims(row.bioClaims as unknown as BioClaim[]),
        sourceText: null,
        sourceTextHash: null,
      }),
    );
  }

  /**
   * Page through one family, recording each row's claims.
   *
   * A row that fails is logged and skipped rather than aborting the run: one
   * malformed blob must not cost the other 1,496 claims their backfill. The
   * count is reported, because the verdict distribution cannot show it — that
   * number is a query over what was stored, so it looks just as tidy and
   * complete when a third of the corpus never arrived.
   *
   * Pages by keyset (`id > afterId`) rather than by offset. Ids are random
   * UUIDs, so a row inserted by a live generator mid-run lands anywhere in the
   * ordering; under `skip`/`take` an insert before the current window shifts
   * everything right and the row at the boundary is never read. A repeat would
   * be harmless here — `recordClaims` is idempotent — but a silent skip is
   * not, in a backfill whose whole purpose is completeness.
   */
  private async eachBatch<TRow extends { id: string }>(
    limit: number | undefined,
    read: (afterId: string | null, take: number) => Promise<TRow[]>,
    toInput: (row: TRow) => ClaimRecordInput,
  ): Promise<number> {
    let processed = 0;
    let afterId: string | null = null;

    for (;;) {
      const remaining = limit === undefined ? BATCH_SIZE : limit - processed;
      if (remaining <= 0) break;

      const rows = await read(afterId, Math.min(BATCH_SIZE, remaining));
      if (rows.length === 0) break;

      for (const row of rows) {
        const input = toInput(row);
        try {
          await recordClaims(this.db, input);
        } catch (error) {
          this.failed += 1;
          this.logger.error(
            `Backfill failed for ${input.subjectType} ${input.subjectId}: ` +
              `${(error as Error).message}`,
          );
        }
        processed += 1;
      }
      afterId = rows[rows.length - 1].id;
    }

    return processed;
  }
}
