import { DbService } from '@opuspopuli/relationaldb-provider';

import { spentScheduleFilter } from '../../../src/apps/region/src/domains/expenditure-schedules';
import {
  cleanDatabase,
  createCommittee,
  createExpenditure,
  getDbService,
} from '../utils';

/**
 * The spend-schedule predicate, against a REAL database (#1367).
 *
 * This exists because the unit tests could not catch what broke: those
 * services are mocked against a `where` object that accepts anything, so
 * folding this filter into a shared clause and applying it to
 * `filing_reconciliations` — a table with no `scheduleCode` column — passed
 * every unit test and failed at runtime on every funding page. A real Prisma
 * client is the only thing that validates the shape.
 *
 * It also pins the semantics sourced from `cal_format_201.pdf`: `D` is a
 * "Summary of Expenditures" and ALL Schedule `G` rows are "sub-itemizations
 * for items that appear on the 460's Schedule E or Schedule F", so counting
 * either double-counts a payment already in the total.
 */
describe('expenditure spend schedules (#1367)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  it('counts payments made and excludes memo restatements of them', async () => {
    const committee = await createCommittee();
    // One row per schedule the dictionary defines for EXPN.
    for (const [scheduleCode, amount] of [
      ['E', 100],
      ['F450P5', 200],
      ['F461P5', 400],
      ['F465P3', 800],
      ['D', 1_000_000],
      ['G', 2_000_000],
    ] as const) {
      await createExpenditure({
        committeeId: committee.id,
        scheduleCode,
        amount,
        payeeName: `payee-${scheduleCode}`,
      });
    }

    const spent = await db.expenditure.aggregate({
      where: { committeeId: committee.id, ...spentScheduleFilter() },
      _sum: { amount: true },
    });

    // Distinct powers of two, so a wrong set is identifiable from the sum
    // rather than merely unequal.
    expect(Number(spent._sum.amount)).toBe(1_500);
  });

  it('accepts the predicate on a real Prisma client', async () => {
    // The regression: `scheduleCode` must exist as a filterable column on
    // THIS model. A `where` the mocks accept and Prisma rejects is the bug
    // this file exists for.
    await expect(
      db.expenditure.findMany({ where: spentScheduleFilter(), take: 1 }),
    ).resolves.toBeDefined();
  });

  it('excludes a row whose schedule is unknown', async () => {
    const committee = await createCommittee();
    // Created directly, NOT through `createExpenditure`: that fixture now
    // defaults the schedule to 'E', and `null ?? 'E'` is 'E' — so asking the
    // fixture for a null schedule quietly gives you a counted row. Only the
    // raw client can produce the pre-#992 shape under test.
    await db.expenditure.create({
      data: {
        externalId: 'unknown-schedule-1',
        committeeId: committee.id,
        payeeName: 'Pre-#992 row',
        amount: 5_000,
        date: new Date('2026-01-01'),
        sourceSystem: 'cal_access',
        scheduleCode: null,
      },
    });

    const spent = await db.expenditure.aggregate({
      where: { committeeId: committee.id, ...spentScheduleFilter() },
      _sum: { amount: true },
    });

    // A null schedule cannot be shown to be a payment rather than a memo, and
    // counting an unknown as spend is the error being removed. Zero rows in
    // the 2026-10-14 corpus carry null; a pre-#992 row would.
    expect(spent._sum.amount).toBeNull();
  });

  it('the default fixture produces a row that COUNTS', async () => {
    // The CI failure that led here: `createExpenditure` set no schedule, so
    // every seeded expenditure silently vanished from the totals under test.
    // A fixture must look like a row the real pipeline produces.
    const committee = await createCommittee();
    await createExpenditure({ committeeId: committee.id, amount: 42 });

    const spent = await db.expenditure.aggregate({
      where: { committeeId: committee.id, ...spentScheduleFilter() },
      _sum: { amount: true },
    });

    expect(Number(spent._sum.amount)).toBe(42);
  });
});
