import { Injectable, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { toNumber } from './finance-money';

/**
 * What a funding figure rests on (#991).
 *
 * `totalRaised` / `totalSpent` are single numbers, and a single number cannot
 * say which parts of it we can describe. These fields say it. Three kinds of
 * uncertainty, deliberately NOT merged into one "figures may be incomplete"
 * caveat — they are different facts and attach to different totals:
 *
 * | | money | which total | what is unknown |
 * |---|---|---|---|
 * | undated       | we hold it      | in `totalSpent`     | *when* it was spent |
 * | unattributed  | we hold it      | in `totalSpent`     | *to whom* it went |
 * | unitemized    | we do NOT hold it | missing from `totalRaised` | everything but the sum |
 *
 * Undated and unattributed are money the committee reported and we store; the
 * row is in the total and the total is right. Unitemized is money a committee
 * reported in aggregate on a Form 460 summary line with no detail rows behind
 * it — sub-$100 contributions it is not required to itemize. We never had
 * those rows, so that money is *absent* from `totalRaised`, not poorly
 * described within it.
 */
export interface FundingBasis {
  /** Expenditures in `totalSpent` with no reported date. */
  undatedAmount: number;
  undatedCount: number;
  /** Expenditures in `totalSpent` with no reported payee. */
  unattributedAmount: number;
  unattributedCount: number;
  /**
   * Contributions reported on a summary line with no detail rows, so NOT in
   * `totalRaised`. Reported − itemized, from `filing_reconciliations`.
   */
  unitemizedAmount: number;
  /**
   * How many of these committees' filings have been reconciled against their
   * summary totals.
   *
   * Without this, `unitemizedAmount === 0` is ambiguous in the worst
   * direction: it is what you get when every filing was reconciled and none
   * hid money, AND what you get when the reconciliation pass has never run
   * for this committee. Only the first licenses saying contributions were
   * fully itemized.
   */
  reconciledFilings: number;
  /**
   * `last-modified` of the bulk export these figures came from — which
   * snapshot of the public record a reader is looking at. Null when no bulk
   * snapshot recorded it, and then it stays null: our own sync time is a
   * different fact and substituting it would be a quiet lie.
   */
  asOfSource: Date | null;
  /**
   * Whether these numbers were actually computed.
   *
   * Without this, the all-zero fallback is indistinguishable from a real
   * measurement that found nothing — and the surface renders that as "every
   * expenditure on file carries both a reported date and a reported payee".
   * This service is injected `@Optional()`, so a provider dropped in a
   * refactor or unresolved in one deployment unit would publish an
   * affirmative completeness claim about $11.87B that nobody measured, to
   * anonymous readers, cached for four hours — with no throw and no log.
   *
   * The same reasoning already governs the cache: a pre-#991 entry is treated
   * as a miss rather than defaulted to zeros. "Nothing is missing" and
   * "nobody looked" must never render alike.
   */
  measured: boolean;
}

/** Data type the CAL-ACCESS bulk export is archived under. */
const FINANCE_DATA_TYPE = 'campaign_finance';

/** The not-measured fallback. `measured: false` is the load-bearing field. */
export const EMPTY_FUNDING_BASIS: FundingBasis = {
  undatedAmount: 0,
  undatedCount: 0,
  unattributedAmount: 0,
  unattributedCount: 0,
  unitemizedAmount: 0,
  reconciledFilings: 0,
  asOfSource: null,
  measured: false,
};

/**
 * Computes the disclosure that travels with every funding total (#991).
 *
 * Shared by `RepresentativeFundingService` and `PropositionFundingService`
 * rather than duplicated: the two surfaces must not be able to drift into
 * disclosing the same gap differently.
 *
 * **`undatedAmount` and `unattributedAmount` can overlap and must never be
 * summed.** A row missing both a date and a payee is counted in both. Measured
 * on the 2026-10-12 archive the overlap is 292 rows of 9,044,935 — small, but
 * "undated + unattributed" would still be a number that describes nothing.
 * Each figure is independently true as "$X of the total has no reported Y".
 */
@Injectable()
export class FundingBasisService {
  constructor(@Optional() private readonly db?: DbService) {}

  /**
   * `last-modified` of the newest finance bulk export, for callers that need
   * the same value for several committee sets.
   *
   * Public so `PropositionFundingService` can resolve it ONCE and hand it to
   * both sides: the two sides are two committee sets, and each would
   * otherwise issue the identical query and get the identical row.
   */
  async sourceDate(): Promise<Date | null> {
    return this.db ? this.resolveAsOfSource() : null;
  }

  /**
   * The basis for the expenditures and filings of a set of committees.
   *
   * Pass `precomputed` to reuse an `asOfSource` already resolved by
   * `sourceDate()`. Its *presence* is what counts — `{ asOfSource: null }`
   * means "already looked, unrecorded", which is different from omitting it.
   */
  async forCommittees(
    committeeIds: string[],
    precomputed?: { asOfSource: Date | null },
  ): Promise<FundingBasis> {
    if (!this.db) return { ...EMPTY_FUNDING_BASIS };

    // No committees still has a knowable `asOfSource`: a proposition side can
    // be funded entirely by independent expenditures, and that figure still
    // came from a dated export. Skip only the three aggregates, which are
    // zero by construction.
    if (committeeIds.length === 0) {
      // Measured: with no committees the three sums are zero by construction,
      // which is an answer rather than an absence of one.
      return {
        ...EMPTY_FUNDING_BASIS,
        asOfSource: precomputed
          ? precomputed.asOfSource
          : await this.resolveAsOfSource(),
        measured: true,
      };
    }

    const where = { committeeId: { in: committeeIds } };
    const [undated, unattributed, unitemized, asOfSource] = await Promise.all([
      this.db.expenditure.aggregate({
        where: { ...where, date: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.db.expenditure.aggregate({
        where: { ...where, payeeName: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.db.filingReconciliation.aggregate({
        where,
        _sum: { unitemizedContributions: true },
        _count: { _all: true },
      }),
      precomputed ? precomputed.asOfSource : this.resolveAsOfSource(),
    ]);

    return {
      undatedAmount: toNumber(undated._sum.amount),
      undatedCount: undated._count._all,
      unattributedAmount: toNumber(unattributed._sum.amount),
      unattributedCount: unattributed._count._all,
      unitemizedAmount: toNumber(unitemized._sum.unitemizedContributions),
      reconciledFilings: unitemized._count._all,
      asOfSource,
      measured: true,
    };
  }

  /**
   * `last-modified` of the newest finance bulk export we archived. Null — and
   * left null — when nothing recorded it: a reader who is not told which
   * export a figure came from is better served by that silence than by our
   * sync timestamp wearing the label of the source's.
   */
  private async resolveAsOfSource(): Promise<Date | null> {
    // `campaign_finance` is not unique to one source: the federal plugin
    // archives `indiv26.zip` and `cm26.zip` under the same `dataType`, and
    // `regionId` is nullable and not threaded into this service. Taking the
    // newest fetch would therefore date California figures to an FEC export
    // whenever the federal sync ran more recently — the wrong snapshot on the
    // one field whose whole purpose is provenance.
    //
    // So: only answer when the answer is unambiguous. More than one distinct
    // source means we cannot say which export these figures came from, and
    // "unknown" is the honest reply. A region-scoped lookup would let us
    // answer in the multi-source case; that needs a regionId here.
    const sources = await this.db!.bulkSnapshot.findMany({
      where: { dataType: FINANCE_DATA_TYPE },
      distinct: ['sourceUrl'],
      select: { sourceUrl: true },
      take: 2,
    });
    if (sources.length !== 1) return null;

    const snapshot = await this.db!.bulkSnapshot.findFirst({
      where: {
        dataType: FINANCE_DATA_TYPE,
        lastModified: { not: null },
        sourceUrl: sources[0].sourceUrl,
      },
      orderBy: { fetchedAt: 'desc' },
      // KEEP THIS SELECT NARROW. `basis` is served on an unauthenticated
      // query, and this is the only public read path onto `bulk_snapshots`.
      // The row also carries `storageBucket` / `storageKey` / `sourceUrl` /
      // `contentHash` — the object-storage layout of the raw archive. Nothing
      // structurally prevents widening this, so: `lastModified` is an HTTP
      // header from a public CAL-ACCESS endpoint and is the only field here
      // that belongs on a public surface.
      select: { lastModified: true },
    });
    if (!snapshot?.lastModified) return null;

    // Stored as the raw HTTP header string, so it may be anything a server
    // sent. An unparseable value is reported as unknown, not as the epoch.
    const parsed = new Date(snapshot.lastModified);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
