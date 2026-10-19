/**
 * The standalone post-sync triggers, against a REAL database (#1000).
 *
 * The unit specs cover delegation and the guards. They cannot cover the one
 * property this change exists for: that running supersession no longer leaves
 * `filing_reconciliations` serving verdicts about rows that have been deleted.
 *
 * #1000 measured what that costs. After supersession corrected 2M rows
 * underneath it, the table went on reporting `OVER_ITEMIZED: 7,140` when the
 * true figure was 515 — a 14x overstatement of a fault condition, with nothing
 * marking it stale. `reproduces #1000's stale verdict, then corrects it` is
 * that story in miniature: delete the chained `reconcileFilings()` from
 * `supersedeAmendments()` and it fails.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { AmendmentSupersessionService } from '../../../src/apps/region/src/domains/amendment-supersession.service';
import { FilingReconciliationService } from '../../../src/apps/region/src/domains/filing-reconciliation.service';
import { RegionDomainService } from '../../../src/apps/region/src/domains/region.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const FILING = 'F-1000-A';

describe('post-sync standalone triggers (#1000)', () => {
  let db: DbService;
  let service: RegionDomainService;
  let reconciliation: FilingReconciliationService;

  beforeAll(async () => {
    db = await getDbService();
    reconciliation = new FilingReconciliationService(db);
    service = new RegionDomainService(
      // The facade's sync/query/backfill collaborators are untouched by these
      // two methods, so they are deliberately absent rather than stubbed —
      // a stub would imply this test exercises them.
      undefined as never,
      undefined as never,
      undefined as never,
      new AmendmentSupersessionService(db),
      reconciliation,
    );
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /**
   * One filing reported at $100, whose Schedule A detail exists twice: once
   * under the superseded amendment 0 and once under the current amendment 1.
   *
   * CAL-ACCESS restates a whole schedule on amendment, so both rows are the
   * same $100 of money. Summed together they read as $200 against $100
   * reported — the double-count that supersession exists to remove, and which
   * reconciliation will call a fault until it does.
   *
   * The summary sits at amendment 1 so that #1376's version check passes and a
   * verdict is actually reached; a mismatched summary would return
   * VERSION_MISMATCH and prove nothing about staleness.
   */
  const seedDoubleCountedFiling = async () => {
    await db.filingSummary.create({
      data: {
        externalId: `${FILING}:1:F460:1`,
        filingId: FILING,
        amendId: 1,
        formType: 'F460',
        lineItem: '1',
        amountA: '100.00',
        sourceSystem: 'cal_access',
      },
    });

    for (const amendId of [0, 1]) {
      await db.contribution.create({
        data: {
          externalId: `${FILING}:${amendId}:1:A`,
          filingId: FILING,
          amendId,
          scheduleCode: 'A',
          donorName: 'Jane Q. Public',
          donorType: 'individual',
          amount: '100.00',
          date: new Date('2026-03-01'),
          sourceSystem: 'cal_access',
        },
      });
    }
  };

  const storedVerdict = () =>
    db.filingReconciliation.findUnique({ where: { filingId: FILING } });

  it("reproduces #1000's stale verdict, then corrects it", async () => {
    await seedDoubleCountedFiling();

    // 1. The pre-supersession state: $200 of detail against $100 reported.
    //    This is the verdict that went on being served for 2M rows.
    const before = await service.reconcileFilings();
    expect(before.overItemizedContributions).toBe(1);
    expect((await storedVerdict())?.contributionStatus).toBe('OVER_ITEMIZED');

    // 2. Supersede, which deletes the amendment-0 row the verdict counted.
    const result = await service.supersedeAmendments();
    expect(result.supersession.contributions.superseded).toBe(1);
    expect(result.supersession.contributions.filingsAffected).toBe(1);

    // 3. The returned summary reflects the corpus as it now stands.
    expect(result.reconciliation.overItemizedContributions).toBe(0);

    // 4. And so does the STORED row — the assertion that matters. A returned
    //    summary nobody persisted would leave the table exactly as stale as
    //    before, which is the failure #1000 describes.
    expect((await storedVerdict())?.contributionStatus).toBe('MATCH');
  });

  it('is idempotent — a second supersede finds nothing left and keeps the verdict', async () => {
    await seedDoubleCountedFiling();
    await service.supersedeAmendments();

    const again = await service.supersedeAmendments();

    expect(again.supersession.contributions.superseded).toBe(0);
    expect(again.reconciliation.overItemizedContributions).toBe(0);
    expect((await storedVerdict())?.contributionStatus).toBe('MATCH');
  });

  it('reconciles a filing with no amendments to supersede', async () => {
    await db.filingSummary.create({
      data: {
        externalId: `${FILING}:0:F460:1`,
        filingId: FILING,
        amendId: 0,
        formType: 'F460',
        lineItem: '1',
        amountA: '100.00',
        sourceSystem: 'cal_access',
      },
    });
    await db.contribution.create({
      data: {
        externalId: `${FILING}:0:1:A`,
        filingId: FILING,
        amendId: 0,
        scheduleCode: 'A',
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount: '100.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    const result = await service.supersedeAmendments();

    expect(result.supersession.contributions.superseded).toBe(0);
    expect(result.reconciliation.reconciled).toBe(1);
    expect((await storedVerdict())?.contributionStatus).toBe('MATCH');
  });

  // The guard, against a real service rather than a mock: a service built with
  // no DbService must error, not report a zeroed success.
  it('refuses to report a zeroed result when no database is bound', async () => {
    const unbound = new RegionDomainService(
      undefined as never,
      undefined as never,
      undefined as never,
      new AmendmentSupersessionService(),
      new FilingReconciliationService(),
    );

    await expect(unbound.reconcileFilings()).rejects.toThrow(
      /no database is bound/i,
    );
    await expect(unbound.supersedeAmendments()).rejects.toThrow(
      /no database is bound/i,
    );
  });
});
