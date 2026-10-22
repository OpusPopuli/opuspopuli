/**
 * F4 — bill lifecycle flags, against a real database.
 *
 * The unit tests prove what the writer asks Prisma to do. These prove the
 * row ends up right: a JSONB-free update is about as plain as Prisma gets,
 * but `refreshBillLifecycleFlags` pages with a cursor, and a cursor that
 * skipped or repeated a row would leave a mislabelled bill nobody re-reads.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  BILL_LIFECYCLE_SELECT,
  refreshBillLifecycleFlags,
  writeBillLifecycleFields,
} from '../../../src/apps/region/src/domains/bill-lifecycle-writer';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const REGION_ID = 'california';
const IN_SESSION = new Date('2026-10-22T12:00:00Z');
const AFTER_SESSION = new Date('2027-03-01T12:00:00Z');

async function seedBill(
  db: DbService,
  externalId: string,
  overrides: {
    status?: string;
    currentStageId?: string | null;
    regionId?: string;
    isDead?: boolean;
    isActive?: boolean;
  } = {},
): Promise<void> {
  await db.bill.create({
    data: {
      externalId,
      regionId: overrides.regionId ?? REGION_ID,
      billNumber: externalId,
      sessionYear: '2025-2026',
      measureTypeCode: 'AB',
      title: `Test bill ${externalId}`,
      sourceUrl: `https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=${externalId}`,
      status: overrides.status ?? 'Active Bill - In Committee Process',
      currentStageId:
        overrides.currentStageId === undefined
          ? 'in_committee'
          : overrides.currentStageId,
      isActive: overrides.isActive ?? true,
      isDead: overrides.isDead ?? false,
    },
  });
}

async function flags(db: DbService, externalId: string) {
  return db.bill.findUniqueOrThrow({
    where: { externalId },
    select: { isDead: true, isActive: true },
  });
}

describe('bill lifecycle writer — integration (F4)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('a patched dead stage leaves the row dead', async () => {
    await seedBill(db, '202520260AB1');
    const row = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB1' },
      select: BILL_LIFECYCLE_SELECT,
    });

    await writeBillLifecycleFields(
      db,
      row,
      { currentStageId: 'failed-passage' },
      {},
      IN_SESSION,
    );

    expect(await flags(db, '202520260AB1')).toEqual({
      isDead: true,
      isActive: false,
    });
  });

  it('flags describe the row as written even when it changed after the read', async () => {
    // The real P2025 path: Prisma's extended-where update against Postgres.
    await seedBill(db, '202520260AB2');
    const stale = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB2' },
      select: BILL_LIFECYCLE_SELECT,
    });
    // A concurrent writer marks it dead after our read.
    await db.bill.update({
      where: { externalId: '202520260AB2' },
      data: { status: 'Inactive Bill - Died' },
    });

    await writeBillLifecycleFields(
      db,
      stale,
      { currentStageId: 'in_committee' },
      {},
      IN_SESSION,
    );

    expect(await flags(db, '202520260AB2')).toEqual({
      isDead: true,
      isActive: false,
    });
  });

  it('a closed session kills every unfinished bill, across pages, and spares the chaptered', async () => {
    // Six bills over three pages of two: a cursor that skipped or repeated a
    // row would leave one mislabelled.
    for (const id of ['A1', 'A2', 'A3', 'A4']) await seedBill(db, id);
    // Seeded WRONG (dead), so passing proves a recompute rather than a skip.
    await seedBill(db, 'CH1', {
      status: 'Chaptered by Secretary of State',
      currentStageId: 'chaptered',
      isDead: true,
    });
    // Enacted with no stage resolved — 140 such bills in dev, which the
    // stage-only rule would have killed on the first sync of 2027.
    await seedBill(db, 'CH2', {
      status: 'Chaptered by Secretary of State - Chapter 12, Statutes of 2025.',
      currentStageId: null,
    });
    // Another region's stale bill: out of scope, must be left alone.
    await seedBill(db, 'OTHER1', { regionId: 'sonoma' });

    const counts = await refreshBillLifecycleFlags(db, {
      regionId: REGION_ID,
      batchSize: 2,
      today: AFTER_SESSION,
    });

    expect(counts.scanned).toBe(6);
    for (const id of ['A1', 'A2', 'A3', 'A4']) {
      expect(await flags(db, id)).toEqual({ isDead: true, isActive: false });
    }
    // Enacted law from a closed session is not dead — by stage or by status.
    expect(await flags(db, 'CH1')).toEqual({ isDead: false, isActive: false });
    expect(await flags(db, 'CH2')).toEqual({ isDead: false, isActive: false });
    expect(await flags(db, 'OTHER1')).toEqual({
      isDead: false,
      isActive: true,
    });
  });
});
