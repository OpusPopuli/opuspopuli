import { DbService } from '@opuspopuli/relationaldb-provider';
import { CoverPageLinkerService } from './cover-page-linker.service';

/**
 * These cover orchestration only — which statements run, in what order, and how
 * the counters are derived. The join itself is raw SQL, so its correctness is
 * asserted against a real database in
 * `__tests__/integration/region/cover-page-linker.integration.spec.ts`.
 */
function build(opts: {
  contributionCount?: number;
  expenditureCount?: number;
  updated?: number[];
  hadCoverPage?: number;
}) {
  const executeRawUnsafe = jest.fn();
  for (const n of opts.updated ?? [0, 0]) {
    executeRawUnsafe.mockResolvedValueOnce(n);
  }
  const queryRawUnsafe = jest
    .fn()
    .mockResolvedValue([{ count: BigInt(opts.hadCoverPage ?? 0) }]);

  const db = {
    contribution: {
      count: jest.fn().mockResolvedValue(opts.contributionCount ?? 0),
    },
    expenditure: {
      count: jest.fn().mockResolvedValue(opts.expenditureCount ?? 0),
    },
    $executeRawUnsafe: executeRawUnsafe,
    $queryRawUnsafe: queryRawUnsafe,
  } as unknown as DbService;

  return {
    svc: new CoverPageLinkerService(db),
    executeRawUnsafe,
    queryRawUnsafe,
    db,
  };
}

describe('CoverPageLinkerService (#980)', () => {
  it('returns empty counts when no db is injected', async () => {
    const res = await new CoverPageLinkerService().linkAll();

    expect(res.contributions.considered).toBe(0);
    expect(res.expenditures.considered).toBe(0);
  });

  it('skips the UPDATE entirely when nothing is unattributed', async () => {
    const { svc, executeRawUnsafe } = build({});

    const res = await svc.linkAll();

    // The common steady-state case: a re-sync with everything already linked
    // must not scan or write.
    expect(executeRawUnsafe).not.toHaveBeenCalled();
    expect(res.contributions).toMatchObject({ considered: 0, linked: 0 });
  });

  it('only considers unattributed rows that carry a filingId', async () => {
    const { svc, db } = build({ contributionCount: 1, updated: [1, 0] });

    await svc.linkAll();

    // Idempotency: an already-linked row must never be rewritten or unlinked.
    expect(db.contribution.count).toHaveBeenCalledWith({
      where: { committeeId: null, filingId: { not: null } },
    });
  });

  it('links both tables in one statement each', async () => {
    const { svc, executeRawUnsafe } = build({
      contributionCount: 1200000,
      expenditureCount: 400000,
      updated: [1200000, 400000],
    });

    const res = await svc.linkAll();

    // One UPDATE per table — not one per row. At 1.2M rows the row-by-row
    // shape #955 uses would mean 1.2M promises across ~2,400 transactions.
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(res.contributions.linked).toBe(1200000);
    expect(res.expenditures.linked).toBe(400000);

    const statements = executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements[0]).toContain('UPDATE "contributions"');
    expect(statements[1]).toContain('UPDATE "expenditures"');
    for (const sql of statements) {
      expect(sql).toContain('"committee_id" IS NULL');
      expect(sql).toContain('"deleted_at" IS NULL');
    }
  });

  it('does not run the breakdown query when everything resolved', async () => {
    const { svc, queryRawUnsafe } = build({
      contributionCount: 10,
      expenditureCount: 0,
      updated: [10, 0],
    });

    const res = await svc.linkAll();

    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(res.contributions).toMatchObject({
      linked: 10,
      skippedNoCoverPage: 0,
      skippedNoCommittee: 0,
    });
  });

  it('splits leftovers into no-cover-page vs no-committee', async () => {
    const { svc } = build({
      contributionCount: 10,
      expenditureCount: 0,
      updated: [6, 0],
      hadCoverPage: 3, // of the 4 unlinked, 3 have a cover page whose filer is unknown
    });

    const res = await svc.linkAll();

    expect(res.contributions).toMatchObject({
      considered: 10,
      linked: 6,
      skippedNoCommittee: 3,
      skippedNoCoverPage: 1,
    });
  });
});
