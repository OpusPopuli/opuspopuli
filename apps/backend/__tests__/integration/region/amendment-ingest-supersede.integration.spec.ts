/**
 * Ingest-then-supersede integration tests (#992).
 *
 * The two halves of the amendment fix are only correct *together*, and each is
 * proven separately elsewhere: `campaign-finance-sync.service.spec.ts` asserts
 * the write guard against mocks, `amendment-supersession.integration.spec.ts`
 * asserts the delete against a real database. Neither covers the seam.
 *
 * The seam is where the damage would be. Supersession deletes every row below
 * `max(amend_id)` for a filing, so it trusts the `amend_id` ingest stored. If a
 * merged row keeps a stale one — which is what plain last-write-wins does for
 * the 454 `RCPT_CD` rows whose `AMEND_ID` decreases in file order — supersession
 * deletes a row the current amendment still contains, and the committee's total
 * silently drops. Nothing throws. So these tests run the real write path into a
 * real `postgres_test` and then run the real delete over the result.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { CampaignFinanceSyncService } from '../../../src/apps/region/src/domains/campaign-finance-sync.service';
import { AmendmentSupersessionService } from '../../../src/apps/region/src/domains/amendment-supersession.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

describe('amendment ingest + supersession (#992)', () => {
  let db: DbService;
  let sync: CampaignFinanceSyncService;
  let supersession: AmendmentSupersessionService;

  beforeAll(async () => {
    db = await getDbService();
    sync = new CampaignFinanceSyncService(db);
    supersession = new AmendmentSupersessionService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /**
   * A contribution as it reaches the upsert — the shape `sortItems` produces
   * from a mapped RCPT_CD row.
   */
  const row = (
    externalId: string,
    amendId: number,
    amount: number,
    filingId = '2505994',
  ) => ({
    externalId,
    filingId,
    amendId,
    donorName: 'Jane Q. Public',
    donorType: 'individual',
    amount,
    date: new Date('2026-03-01'),
    sourceSystem: 'cal_access',
  });

  /** Drive the real batch write path, exactly as a streamed batch would. */
  const ingest = (contributions: ReturnType<typeof row>[]) =>
    (
      sync as unknown as {
        upsertBatch: (d: unknown) => Promise<{ processed: number }>;
      }
    ).upsertBatch({
      committees: [],
      contributions,
      expenditures: [],
      independentExpenditures: [],
      committeeMeasureFilings: [],
      cvrFilings: [],
      filingSummaries: [],
    });

  const stored = () =>
    db.contribution.findMany({
      select: { externalId: true, amendId: true, amount: true },
      orderBy: { externalId: 'asc' },
    });

  const total = async () =>
    (await stored()).reduce((sum, r) => sum + Number(r.amount), 0);

  it('keeps the amended total when the restatement arrives first in the file', async () => {
    // The failure this pair exists to prevent, end to end. Filing 2505994's
    // amendment restates $170,988.25 across two rows; one of them reuses the
    // original's identifier and so merges onto it. Here the amend-1 version of
    // that row arrives BEFORE the amend-0 version, as it does for the 454 rows
    // measured on the 2026-08-09 export.
    //
    // Without the write guard the merged row keeps amend_id 0, supersession
    // reads it as superseded, deletes it, and the filing reports $80,988.25
    // against an official $170,988.25 — a silent 53% under-count.
    await ingest([
      row('2505994:7:BBB', 1, 90000), // restatement, arrives first
      row('2505994:7:BBB', 0, 68135), // superseded version of the same row
      row('2505994:8:CCC', 1, 80988.25), // new row, only in the amendment
    ]);

    await supersession.supersedeAll();

    const rows = await stored();
    expect(rows.map((r) => r.externalId)).toEqual([
      '2505994:7:BBB',
      '2505994:8:CCC',
    ]);
    expect(rows.every((r) => r.amendId === 1)).toBe(true);
    expect(await total()).toBeCloseTo(170988.25, 2);
  });

  it('keeps the amended total when the file is in ascending order', async () => {
    // The ordinary case, asserted so the guard is not silently doing nothing.
    await ingest([
      row('2505994:7:BBB', 0, 68135),
      row('2505994:7:BBB', 1, 90000),
      row('2505994:8:CCC', 1, 80988.25),
    ]);

    await supersession.supersedeAll();

    expect(await total()).toBeCloseTo(170988.25, 2);
  });

  it('holds when the versions arrive in separate batches, newest first', async () => {
    // Cross-batch: the guard cannot see the older version in memory and has to
    // consult what is already stored.
    await ingest([row('2505994:7:BBB', 1, 90000)]);
    await ingest([row('2505994:7:BBB', 0, 68135)]);

    await supersession.supersedeAll();

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].amendId).toBe(1);
    expect(Number(rows[0].amount)).toBeCloseTo(90000, 2);
  });

  it('applies the amendment when it arrives in a later batch', async () => {
    await ingest([row('2505994:7:BBB', 0, 68135)]);
    await ingest([row('2505994:7:BBB', 1, 90000)]);

    await supersession.supersedeAll();

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBeCloseTo(90000, 2);
  });

  it('leaves an unamended filing at its full total', async () => {
    // The safety property, from the ingest side: nothing about the guard or
    // the delete may touch a filing that was never amended. 644009's itemized
    // detail matched its raw file exactly during #980 verification.
    await ingest([
      row('644009:1:AAA', 0, 34250, '644009'),
      row('644009:2:BBB', 0, 1000, '644009'),
    ]);

    await supersession.supersedeAll();

    expect(await db.contribution.count({ where: { filingId: '644009' } })).toBe(
      2,
    );
    expect(await total()).toBeCloseTo(35250, 2);
  });

  it('re-ingesting the same export changes nothing', async () => {
    // A rebuild that runs twice, or a retried batch, must not shift a total.
    const batch = [
      row('2505994:7:BBB', 1, 90000),
      row('2505994:8:CCC', 1, 80988.25),
    ];

    await ingest(batch);
    await supersession.supersedeAll();
    await ingest(batch);
    await supersession.supersedeAll();

    expect(await stored()).toHaveLength(2);
    expect(await total()).toBeCloseTo(170988.25, 2);
  });
});
