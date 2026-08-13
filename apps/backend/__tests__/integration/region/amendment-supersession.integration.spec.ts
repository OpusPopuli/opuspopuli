/**
 * AmendmentSupersessionService integration tests (#992).
 *
 * This service DELETES production finance rows, so these run against a real
 * `postgres_test` rather than a mock — the SQL is what needs proving, and a
 * mocked Prisma would assert only that the code calls itself.
 *
 * The case that matters most is the negative one: a filing with a single
 * amendment must be left completely alone. If the subquery were ever wrong in
 * that direction, the service would quietly delete live contributions and every
 * count it reports would still look plausible.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { AmendmentSupersessionService } from '../../../src/apps/region/src/domains/amendment-supersession.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

describe('AmendmentSupersessionService (#992)', () => {
  let db: DbService;
  let svc: AmendmentSupersessionService;

  beforeAll(async () => {
    db = await getDbService();
    svc = new AmendmentSupersessionService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /**
   * Amendments restate with NEW TRAN_ID/LINE_ITEM values, so externalIds differ
   * between versions — that is precisely why the composite key cannot merge
   * them and this service exists.
   */
  const contribution = (
    filingId: string,
    amendId: number | null,
    externalId: string,
    amount: string,
  ) =>
    db.contribution.create({
      data: {
        externalId,
        filingId,
        amendId,
        committeeId: null,
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount,
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

  it('removes the superseded version and keeps the latest', async () => {
    // Modelled on filing 2505994: amend 0 held $168,135 and amend 1 restated
    // the schedule at $170,988.25, which matched the official Form 460 total.
    await contribution('2505994', 0, '2505994:1:AAA', '168135.00');
    await contribution('2505994', 1, '2505994:7:BBB', '90000.00');
    await contribution('2505994', 1, '2505994:8:CCC', '80988.25');

    const res = await svc.supersedeAll();

    expect(res.contributions).toMatchObject({
      superseded: 1,
      filingsAffected: 1,
    });

    const left = await db.contribution.findMany({
      where: { filingId: '2505994' },
      select: { externalId: true, amendId: true },
      orderBy: { externalId: 'asc' },
    });
    expect(left.map((r) => r.externalId)).toEqual([
      '2505994:7:BBB',
      '2505994:8:CCC',
    ]);
    expect(left.every((r) => r.amendId === 1)).toBe(true);
  });

  it('leaves a single-amendment filing completely untouched', async () => {
    // The safety property. A filing's only version IS the maximum, so it can
    // never be below it — if this ever fails, the service is deleting live data.
    await contribution('644009', 0, '644009:1:AAA', '35250.00');
    await contribution('644009', 0, '644009:2:BBB', '1000.00');

    const res = await svc.supersedeAll();

    expect(res.contributions).toMatchObject({
      superseded: 0,
      filingsAffected: 0,
    });
    expect(await db.contribution.count({ where: { filingId: '644009' } })).toBe(
      2,
    );
  });

  it('never touches rows with a null amend_id', async () => {
    // Rows ingested before #992 carry no amend_id. They must be inert here
    // rather than being treated as "version null" and deleted.
    await contribution('900100', null, '900100:1:AAA', '500.00');
    await contribution('900100', null, '900100:2:BBB', '600.00');

    await svc.supersedeAll();

    expect(await db.contribution.count({ where: { filingId: '900100' } })).toBe(
      2,
    );
  });

  it('orders amendments numerically, not lexically', async () => {
    // The reason amend_id is an integer. As text, '10' sorts below '9', so a
    // filing amended ten times would keep version 9 and delete the current one
    // — while reporting success.
    await contribution('900200', 9, '900200:1:NINE', '100.00');
    await contribution('900200', 10, '900200:2:TEN', '200.00');

    await svc.supersedeAll();

    const left = await db.contribution.findMany({
      where: { filingId: '900200' },
      select: { amendId: true },
    });
    expect(left).toHaveLength(1);
    expect(left[0].amendId).toBe(10);
  });

  it('scopes supersession to each filing independently', async () => {
    await contribution('900300', 0, '900300:1:A', '10.00');
    await contribution('900300', 1, '900300:2:B', '20.00');
    await contribution('900400', 0, '900400:1:C', '30.00');

    await svc.supersedeAll();

    // 900400's only version survives even though 900300 has a higher amend_id.
    const rows = await db.contribution.findMany({
      select: { filingId: true, amendId: true },
      orderBy: { filingId: 'asc' },
    });
    expect(rows).toEqual([
      { filingId: '900300', amendId: 1 },
      { filingId: '900400', amendId: 0 },
    ]);
  });

  it('is idempotent — a second run removes nothing', async () => {
    await contribution('900500', 0, '900500:1:A', '10.00');
    await contribution('900500', 2, '900500:2:B', '20.00');

    await svc.supersedeAll();
    const second = await svc.supersedeAll();

    expect(second.contributions).toMatchObject({
      superseded: 0,
      filingsAffected: 0,
    });
    expect(await db.contribution.count()).toBe(1);
  });

  it('supersedes expenditures on the same rule', async () => {
    const expenditure = (amendId: number, externalId: string, amt: string) =>
      db.expenditure.create({
        data: {
          externalId,
          filingId: '900600',
          amendId,
          committeeId: null,
          payeeName: 'Some Print Shop',
          amount: amt,
          date: new Date('2026-03-01'),
          sourceSystem: 'cal_access',
        },
      });
    await expenditure(0, '900600:1:A', '500.00');
    await expenditure(1, '900600:2:B', '750.00');

    const res = await svc.supersedeAll();

    expect(res.expenditures).toMatchObject({
      superseded: 1,
      filingsAffected: 1,
    });
    const left = await db.expenditure.findMany({ select: { amendId: true } });
    expect(left).toEqual([{ amendId: 1 }]);
  });

  it('does nothing when no db is injected', async () => {
    const res = await new AmendmentSupersessionService().supersedeAll();
    expect(res.contributions.superseded).toBe(0);
  });

  /**
   * Regression for #997: the delete loop must run until the work is done, not
   * until an estimate says it should be.
   *
   * The old bound was `ceil((filingsAffected * 50) / 25_000) + 10`, guessing at
   * most 50 superseded rows per filing. On the 2026-08-13 rebuild the real
   * figure was ~256, so the loop ran out of iterations with 2,014,849 rows left
   * and returned reporting success — every abandoned filing then over-counted
   * on the public totals.
   *
   * Reproducing that arithmetic exactly would need >275,000 rows for a single
   * filing, which is not a reasonable thing to insert on every CI run. So this
   * asserts the PROPERTY the fix guarantees — a completed run leaves nothing
   * superseded behind — over a dataset large enough to span several batches.
   * The old code passed this too; what protects the invariant now is that the
   * service re-checks the database and throws rather than logging success.
   */
  it('deletes every superseded row across multiple batches', async () => {
    const CURRENT = 'AMEND-1-SURVIVES';
    const superseded = Array.from({ length: 26_000 }, (_, i) => ({
      externalId: `910001:${i}:OLD`,
      filingId: '910001',
      amendId: 0,
      donorName: 'Jane Q. Public',
      donorType: 'individual',
      amount: '10.00',
      date: new Date('2026-03-01'),
      sourceSystem: 'cal_access',
    }));

    await db.contribution.createMany({ data: superseded });
    await db.contribution.create({
      data: {
        externalId: '910001:0:NEW',
        filingId: '910001',
        amendId: 1,
        donorName: CURRENT,
        donorType: 'individual',
        amount: '99.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    const res = await svc.supersedeAll();

    expect(res.contributions.superseded).toBe(26_000);

    // The invariant, checked against the database rather than the counter —
    // the counter is precisely what read as success while 2M rows remained.
    const left = await db.contribution.findMany({
      where: { filingId: '910001' },
      select: { amendId: true, donorName: true },
    });
    expect(left).toEqual([{ amendId: 1, donorName: CURRENT }]);
  }, 120_000);
});
