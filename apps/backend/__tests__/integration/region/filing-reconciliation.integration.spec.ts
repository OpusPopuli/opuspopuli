/**
 * FilingReconciliationService integration tests (#992, subtask 4b).
 *
 * The whole service is one SQL statement, so a mocked Prisma would assert only
 * that the code calls itself. These run against a real `postgres_test`.
 *
 * Two properties carry the weight:
 *
 *   1. Schedule discrimination. `RCPT_CD` holds every receipt schedule, and
 *      Form 460 line 1 covers Schedule A alone. Measured across all 122,033
 *      F460 filings, summing every schedule instead flags 29% of filings as
 *      over-counting against a true rate of 0.31%. The test that proves this
 *      is `ignores non-Schedule-A receipts` — delete the schedule filter from
 *      the service and it fails.
 *
 *   2. Direction. Detail BELOW reported is expected (unitemized <$100 money);
 *      detail ABOVE reported is a fault. Conflating them would make the table
 *      report a third of California's filings as broken.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { FilingReconciliationService } from '../../../src/apps/region/src/domains/filing-reconciliation.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

describe('FilingReconciliationService (#992)', () => {
  let db: DbService;
  let svc: FilingReconciliationService;

  beforeAll(async () => {
    db = await getDbService();
    svc = new FilingReconciliationService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /** One Form 460 summary line — what the committee reported about itself. */
  const summary = (
    filingId: string,
    lineItem: string,
    amountA: string,
    amendId = 0,
  ) =>
    db.filingSummary.create({
      data: {
        externalId: `${filingId}:${amendId}:F460:${lineItem}`,
        filingId,
        amendId,
        formType: 'F460',
        lineItem,
        amountA,
        sourceSystem: 'cal_access',
      },
    });

  const contribution = (
    filingId: string,
    externalId: string,
    amount: string,
    scheduleCode: string | null = 'A',
    committeeId: string | null = null,
  ) =>
    db.contribution.create({
      data: {
        externalId,
        filingId,
        amendId: 0,
        scheduleCode,
        committeeId,
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount,
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

  const expenditure = (
    filingId: string,
    externalId: string,
    amount: string,
    scheduleCode: string | null = 'E',
  ) =>
    db.expenditure.create({
      data: {
        externalId,
        filingId,
        amendId: 0,
        scheduleCode,
        payeeName: 'Acme Printing',
        amount,
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

  const verdict = (filingId: string) =>
    db.filingReconciliation.findUnique({ where: { filingId } });

  it('flags a filing whose detail exceeds what the committee reported', async () => {
    // The defect this issue exists for. Filing 2505994 stored $339,123 against
    // an official $170,988 before supersession — both amendment versions.
    await summary('2505994', '1', '170988.25');
    await contribution('2505994', '2505994:1:AAA', '168135.00');
    await contribution('2505994', '2505994:7:BBB', '170988.25');

    const res = await svc.reconcileAll();

    expect(res.overItemizedContributions).toBe(1);

    const row = await verdict('2505994');
    expect(row?.contributionStatus).toBe('OVER_ITEMIZED');
    expect(Number(row?.itemizedContributions)).toBeCloseTo(339123.25, 2);
    expect(Number(row?.reportedContributions)).toBeCloseTo(170988.25, 2);
    // Not unitemized money — we are over, not under.
    expect(row?.unitemizedContributions).toBeNull();
  });

  it('records the unitemized gap when detail falls below reported', async () => {
    // Filing 644009: our detail matched the raw file exactly at $35,250, while
    // the official total was $36,694. The $1,444 difference is contributions
    // under the $100 itemization threshold, which exist nowhere but here.
    await summary('644009', '1', '36694.00');
    await contribution('644009', '644009:1:AAA', '35250.00');

    const res = await svc.reconcileAll();

    expect(res.overItemizedContributions).toBe(0);
    expect(res.withUnitemized).toBe(1);
    expect(res.unitemizedTotal).toBeCloseTo(1444.0, 2);

    const row = await verdict('644009');
    expect(row?.contributionStatus).toBe('UNITEMIZED');
    expect(Number(row?.unitemizedContributions)).toBeCloseTo(1444.0, 2);
  });

  it('reports MATCH when detail equals the reported total', async () => {
    await summary('700001', '1', '5000.00');
    await contribution('700001', '700001:1:AAA', '2000.00');
    await contribution('700001', '700001:2:BBB', '3000.00');

    await svc.reconcileAll();

    const row = await verdict('700001');
    expect(row?.contributionStatus).toBe('MATCH');
    expect(row?.unitemizedContributions).toBeNull();
  });

  /**
   * THE test for subtask 4a. Line 1 is monetary contributions — Schedule A.
   * Schedule C (nonmonetary) and I (misc increases) share the source file and
   * belong to other lines entirely. Counting them against line 1 turns a
   * healthy filing into a false fault report.
   */
  it('ignores non-Schedule-A receipts when reconciling line 1', async () => {
    await summary('700002', '1', '5000.00');
    await contribution('700002', '700002:1:AAA', '5000.00', 'A');
    // Would push the total to $9,500 and read as OVER_ITEMIZED if summed.
    await contribution('700002', '700002:2:BBB', '3000.00', 'C');
    await contribution('700002', '700002:3:CCC', '1500.00', 'I');

    const res = await svc.reconcileAll();

    expect(res.overItemizedContributions).toBe(0);

    const row = await verdict('700002');
    expect(row?.contributionStatus).toBe('MATCH');
    expect(Number(row?.itemizedContributions)).toBeCloseTo(5000.0, 2);
  });

  /**
   * The expenditure counterpart, and a sharper trap: Schedule D is a MEMO
   * schedule restating payments Schedule E already counts, so summing both
   * double-counts ~4.8M rows corpus-wide.
   */
  it('ignores the Schedule D memo rows when reconciling line 6', async () => {
    await summary('700003', '6', '8000.00');
    await expenditure('700003', '700003:1:AAA', '8000.00', 'E');
    await expenditure('700003', '700003:2:BBB', '2500.00', 'D');

    const res = await svc.reconcileAll();

    expect(res.overItemizedExpenditures).toBe(0);

    const row = await verdict('700003');
    expect(row?.expenditureStatus).toBe('MATCH');
    expect(Number(row?.itemizedExpenditures)).toBeCloseTo(8000.0, 2);
  });

  /**
   * Rows ingested before the schedule mapping existed carry NULL. Summing
   * `schedule_code = 'A'` over them yields 0, which would read as "the
   * committee reported $36,694 of entirely unitemized money" — a confident,
   * wrong answer. The service must decline instead.
   */
  it('declines to reconcile detail that carries no schedule', async () => {
    await summary('700004', '1', '36694.00');
    await contribution('700004', '700004:1:AAA', '35250.00', null);

    const res = await svc.reconcileAll();

    expect(res.unknownSchedule).toBe(1);
    expect(res.withUnitemized).toBe(0);
    expect(res.unitemizedTotal).toBe(0);

    const row = await verdict('700004');
    expect(row?.contributionStatus).toBe('UNKNOWN_SCHEDULE');
    // Critically: no unitemized figure invented from an unreadable filing.
    expect(row?.unitemizedContributions).toBeNull();
    // And no itemized figure either. Storing 0 here would be a claim — "this
    // filing itemized nothing" — about a filing we just declined to judge, and
    // it would silently poison any SUM over the column.
    expect(row?.itemizedContributions).toBeNull();
  });

  it('marks a filing with no matching summary line as NO_SUMMARY', async () => {
    // Line 6 present, line 1 absent: expenditures are judged, contributions
    // cannot be.
    await summary('700005', '6', '900.00');
    await contribution('700005', '700005:1:AAA', '1000.00');
    await expenditure('700005', '700005:2:BBB', '900.00');

    await svc.reconcileAll();

    const row = await verdict('700005');
    expect(row?.contributionStatus).toBe('NO_SUMMARY');
    expect(row?.expenditureStatus).toBe('MATCH');
  });

  it('marks a reported total with no stored detail as NO_DETAIL', async () => {
    await summary('700006', '1', '12000.00');

    await svc.reconcileAll();

    const row = await verdict('700006');
    expect(row?.contributionStatus).toBe('NO_DETAIL');
  });

  /**
   * Supersession keeps only the newest amendment's detail, so reconciliation
   * must compare against the newest amendment's SUMMARY. Judging current detail
   * against a superseded total would manufacture faults on every amended filing.
   */
  it('compares against the latest amendment of the summary', async () => {
    await summary('700007', '1', '10000.00', 0);
    await summary('700007', '1', '25000.00', 1);
    await contribution('700007', '700007:9:ZZZ', '25000.00');

    const res = await svc.reconcileAll();

    expect(res.overItemizedContributions).toBe(0);

    const row = await verdict('700007');
    expect(row?.contributionStatus).toBe('MATCH');
    expect(row?.amendId).toBe(1);
    expect(Number(row?.reportedContributions)).toBeCloseTo(25000.0, 2);
  });

  it('stamps the committee the detail was attributed to', async () => {
    const committee = await db.committee.create({
      data: {
        externalId: 'CMTE-1',
        name: 'Committee to Elect Someone',
        type: 'candidate',
        sourceSystem: 'cal_access',
      },
    });

    await summary('700008', '1', '4000.00');
    await contribution('700008', '700008:1:AAA', '4000.00', 'A', committee.id);

    await svc.reconcileAll();

    expect((await verdict('700008'))?.committeeId).toBe(committee.id);
  });

  it('is idempotent — a second run upserts rather than duplicating', async () => {
    await summary('700009', '1', '5000.00');
    await contribution('700009', '700009:1:AAA', '4000.00');

    const first = await svc.reconcileAll();
    const second = await svc.reconcileAll();

    expect(second.reconciled).toBe(first.reconciled);
    expect(await db.filingReconciliation.count()).toBe(1);
  });

  it('re-judges a filing whose detail changed since the last run', async () => {
    await summary('700010', '1', '5000.00');
    await contribution('700010', '700010:1:AAA', '9000.00');

    await svc.reconcileAll();
    expect((await verdict('700010'))?.contributionStatus).toBe('OVER_ITEMIZED');

    // Supersession removes the offending row; the verdict must follow.
    await db.contribution.deleteMany({ where: { externalId: '700010:1:AAA' } });
    await contribution('700010', '700010:2:BBB', '5000.00');

    const res = await svc.reconcileAll();

    expect(res.overItemizedContributions).toBe(0);
    expect((await verdict('700010'))?.contributionStatus).toBe('MATCH');
  });

  it('reconciles only Form 460 summaries', async () => {
    await db.filingSummary.create({
      data: {
        externalId: '700011:0:F450:1',
        filingId: '700011',
        amendId: 0,
        formType: 'F450',
        lineItem: '1',
        amountA: '1000.00',
        sourceSystem: 'cal_access',
      },
    });

    const res = await svc.reconcileAll();

    expect(res.reconciled).toBe(0);
    expect(await verdict('700011')).toBeNull();
  });

  it('returns an empty summary when no database is wired', async () => {
    const res = await new FilingReconciliationService().reconcileAll();

    expect(res).toEqual({
      reconciled: 0,
      overItemizedContributions: 0,
      overItemizedExpenditures: 0,
      withUnitemized: 0,
      unitemizedTotal: 0,
      unknownSchedule: 0,
    });
  });
});
