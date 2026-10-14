import { DbService } from '@opuspopuli/relationaldb-provider';
import { FundingBasisService } from './funding-basis.service';

/**
 * The measurement behind #991's disclosure.
 *
 * Admitting 9,044,935 blank-date / blank-payee expenditure rows moves $11.87B
 * into site totals. These tests pin the three quantities that make that
 * defensible, and the two places a plausible shortcut would quietly lie:
 * merging the overlapping gaps, and dating figures to our sync rather than to
 * the source export.
 */
const decimal = (n: number) => ({ toNumber: () => n });

interface DbStub {
  undated: { amount: number; count: number };
  unattributed: { amount: number; count: number };
  unitemized: number | null;
  lastModified?: string | null;
  sources?: string[];
  reconciled?: number;
}

const buildDb = (stub: DbStub) => {
  const aggregate = jest.fn(
    async ({ where }: { where: Record<string, unknown> }) => {
      const pick = where.date === null ? stub.undated : stub.unattributed;
      return {
        _sum: { amount: decimal(pick.amount) },
        _count: { _all: pick.count },
      };
    },
  );
  const findFirst = jest
    .fn()
    .mockResolvedValue(
      stub.lastModified === undefined
        ? null
        : { lastModified: stub.lastModified },
    );
  // The distinct-source probe: one source = unambiguous. `stub.sources`
  // overrides it to simulate CAL-ACCESS and FEC exports side by side.
  const snapshotFindMany = jest
    .fn()
    .mockResolvedValue(
      (stub.sources ?? ['https://cal-access/dbwebexport.zip']).map(
        (sourceUrl) => ({ sourceUrl }),
      ),
    );
  return {
    db: {
      expenditure: { aggregate },
      filingReconciliation: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            unitemizedContributions:
              stub.unitemized === null ? null : decimal(stub.unitemized),
          },
          _count: { _all: stub.reconciled ?? 0 },
        }),
      },
      bulkSnapshot: { findFirst, findMany: snapshotFindMany },
    } as unknown as DbService,
    aggregate,
    findFirst,
    snapshotFindMany,
  };
};

describe('FundingBasisService (#991)', () => {
  it('reports undated and unattributed money as separate quantities', async () => {
    const { db } = buildDb({
      undated: { amount: 9_750_000, count: 5_232 },
      unattributed: { amount: 2_110_000, count: 3_811 },
      unitemized: 3_430_000,
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1', 'c2']);

    // Kept apart on purpose: a row can be missing BOTH a date and a payee, so
    // any single "incomplete" figure would double-count it and describe
    // nothing. Each is independently true as "$X has no reported Y".
    expect(basis.undatedAmount).toBe(9_750_000);
    expect(basis.undatedCount).toBe(5_232);
    expect(basis.unattributedAmount).toBe(2_110_000);
    expect(basis.unattributedCount).toBe(3_811);
    expect(basis.unitemizedAmount).toBe(3_430_000);
  });

  it('reports how many filings were reconciled, so zero is not read as clean', async () => {
    const { db } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      reconciled: 0,
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    // `unitemizedAmount: 0` with no reconciled filings means "never checked",
    // not "nothing hidden" — the surface must not claim the good reading.
    expect(basis.reconciledFilings).toBe(0);
    expect(basis.measured).toBe(true);
  });

  it('does NOT call a row unattributed when the recipient is named elsewhere', async () => {
    // The defect this exists for (#991 follow-up, found 2026-10-14): Schedule
    // D records its recipient as a CANDIDATE or a MEASURE, so `PAYEE_NAML` is
    // legitimately blank while `CAND_NAML` names who was paid. Counting a
    // blank payee alone told readers "who received it was not reported" about
    // 2,171,960 rows whose recipient the filing states — overstating the
    // figure ~10x platform-wide, and 87x on one member's page.
    const { db, aggregate } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
    });

    await new FundingBasisService(db).forCommittees(['c1']);

    const unattributedWhere = aggregate.mock.calls
      .map((c) => c[0].where)
      .find((w) => w.payeeName === null);
    expect(unattributedWhere).toMatchObject({
      payeeName: null,
      candidateName: null,
      propositionTitle: null,
    });
  });

  it('filters the two expenditure gaps on different columns', async () => {
    const { db, aggregate } = buildDb({
      undated: { amount: 1, count: 1 },
      unattributed: { amount: 2, count: 2 },
      unitemized: 0,
    });

    await new FundingBasisService(db).forCommittees(['c1']);

    const wheres = aggregate.mock.calls.map((c) => c[0].where);
    expect(wheres).toContainEqual(
      expect.objectContaining({ date: null, committeeId: { in: ['c1'] } }),
    );
    expect(wheres).toContainEqual(
      expect.objectContaining({
        payeeName: null,
        committeeId: { in: ['c1'] },
      }),
    );
  });

  it('dates the figures to the source export, not to our sync', async () => {
    const { db } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    expect(basis.asOfSource?.toISOString()).toBe('2026-10-12T08:52:56.000Z');
  });

  it('leaves asOfSource null when nothing recorded the export', async () => {
    const { db } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    // Our sync time is a different fact. Substituting it would label the
    // figures with a date the public record never had.
    expect(basis.asOfSource).toBeNull();
  });

  it('reports an unparseable last-modified as unknown, not as the epoch', async () => {
    const { db } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      lastModified: 'not a date',
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    // The column stores the raw HTTP header, so it can be anything a server
    // sent. `new Date('not a date')` is Invalid Date, which renders as
    // garbage or as 1970 downstream.
    expect(basis.asOfSource).toBeNull();
  });

  it('marks a measured result as measured, so zeros can be trusted', async () => {
    const { db } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    // All-zero AND measured is the only combination that licenses the
    // affirmative all-clear on the public page.
    expect(basis.measured).toBe(true);
  });

  it('still resolves asOfSource for a side funded only by independent expenditures', async () => {
    const { db, aggregate, findFirst } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
    });

    const basis = await new FundingBasisService(db).forCommittees([]);

    // No committees still means a real, dated figure on screen — IE-only
    // sides have money and no committee of their own.
    expect(basis.asOfSource).not.toBeNull();
    expect(findFirst).toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
    // Zero by construction is an answer, not an absence of one.
    expect(basis.measured).toBe(true);
  });

  it('reports an ambiguous source as unknown rather than picking one', async () => {
    // `campaign_finance` is shared with the federal plugin's FEC exports, and
    // `regionId` is not threaded here. Taking the newest fetch would date
    // California figures to an FEC export whenever the federal sync ran more
    // recently — the wrong snapshot on a provenance claim.
    const { db, findFirst } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
      sources: [
        'https://cal-access/dbwebexport.zip',
        'https://fec.gov/indiv26.zip',
      ],
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    expect(basis.asOfSource).toBeNull();
    // Short-circuited before asking which is newest; there is no right answer
    // to that question here.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('reuses a precomputed source date instead of querying again', async () => {
    // The proposition surface resolves this ONCE and hands it to both sides;
    // each side is a committee set and would otherwise fetch the same row.
    const { db, snapshotFindMany, findFirst } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: 0,
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
    });
    const shared = new Date('2026-10-12T08:52:56.000Z');

    const basis = await new FundingBasisService(db).forCommittees(['c1'], {
      asOfSource: shared,
    });

    expect(basis.asOfSource).toBe(shared);
    expect(snapshotFindMany).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns zeros and an unknown source with no DB bound', async () => {
    const basis = await new FundingBasisService().forCommittees(['c1']);

    expect(basis).toEqual({
      undatedAmount: 0,
      undatedCount: 0,
      unattributedAmount: 0,
      unattributedCount: 0,
      unitemizedAmount: 0,
      reconciledFilings: 0,
      asOfSource: null,
      // The field that stops these zeros rendering as "nothing is missing".
      measured: false,
    });
  });

  it('treats a null unitemized sum as zero', async () => {
    const { db } = buildDb({
      undated: { amount: 0, count: 0 },
      unattributed: { amount: 0, count: 0 },
      unitemized: null,
    });

    const basis = await new FundingBasisService(db).forCommittees(['c1']);

    expect(basis.unitemizedAmount).toBe(0);
  });
});
