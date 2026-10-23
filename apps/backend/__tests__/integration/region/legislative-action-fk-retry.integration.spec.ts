/**
 * S2 — the minutes linker survives a bill deleted mid-link, against real
 * Postgres (`docs/plans/S2-per-type-sync-jobs.md`, design §8).
 *
 * The unit spec mocks the error. What only a real database proves is that a
 * batched `$transaction([deleteMany, createMany])` naming a bill that no
 * longer exists raises Prisma's P2003 at all — with its code intact through
 * the batch — and that the retry then writes the action with the reference
 * nulled, as `onDelete: SetNull` would have.
 */
import { DbService } from '@opuspopuli/relationaldb-provider';
import { LegislativeActionLinkerService } from '../../../src/apps/region/src/domains/legislative-action-linker.service';
import {
  cleanDatabase,
  createBill,
  disconnectDatabase,
  getDbService,
} from '../utils';

describe('legislative action write after a bill vanished (S2)', () => {
  let db: DbService;
  let linker: LegislativeActionLinkerService;

  beforeAll(async () => {
    db = await getDbService();
    linker = new LegislativeActionLinkerService(db, {} as never);
  });
  beforeEach(async () => {
    await cleanDatabase();
  });
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('writes the action with the deleted bill nulled, and keeps a live one', async () => {
    const minutes = await db.minutes.create({
      data: {
        externalId: 'ca-assembly-2026-04-28',
        body: 'Assembly',
        date: new Date('2026-04-28'),
        sourceUrl: 'https://clerk.assembly.ca.gov/journal-2026-04-28.pdf',
      },
    });
    const live = await createBill({ billNumber: 'AB 2', externalId: 'b-live' });
    const doomed = await createBill({
      billNumber: 'AB 3',
      externalId: 'b-gone',
    });
    // The snapshot held it; a bills prune running beside this sync deletes it.
    await db.bill.delete({ where: { id: doomed.id } });

    const record = (n: number, billId: string) => ({
      externalId: `${minutes.externalId}-000${n}`,
      minutesId: minutes.id,
      body: 'Assembly',
      date: minutes.date,
      actionType: 'committee_report',
      billId,
      passageStart: 0,
      passageEnd: 10,
    });
    const written = await (
      linker as unknown as {
        writeActions: (
          ctx: { id: string; externalId: string },
          records: unknown[],
        ) => Promise<number>;
      }
    ).writeActions(minutes, [record(1, live.id), record(2, doomed.id)]);

    expect(written).toBe(2);
    const actions = await db.legislativeAction.findMany({
      where: { minutesId: minutes.id },
      orderBy: { externalId: 'asc' },
    });
    expect(actions.map((a) => a.billId)).toEqual([live.id, null]);
  });
});
