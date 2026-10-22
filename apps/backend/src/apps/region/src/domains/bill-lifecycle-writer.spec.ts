import { createMockDbService } from '@opuspopuli/relationaldb-provider/testing';
import {
  lifecycleFlags,
  refreshBillLifecycleFlags,
  writeBillLifecycleFields,
  type BillLifecycleRow,
} from './bill-lifecycle-writer';

/** Mid-session 2026, so 2025-2026 is the active session. */
const TODAY = new Date('2026-10-22T12:00:00Z');

const activeBill: BillLifecycleRow = {
  id: 'bill-1',
  status: 'Active Bill - In Committee Process',
  currentStageId: 'in_committee',
  sessionYear: '2025-2026',
  lastAction: 'Referred to Com. on APPR.',
  lastActionDate: new Date('2026-08-01T00:00:00Z'),
};

describe('writeBillLifecycleFields (F4)', () => {
  const updateData = (db: ReturnType<typeof createMockDbService>) =>
    (db.bill.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

  it('recomputes the flags from the patched stage', async () => {
    // The F4 failure: the summary pass set a dead stage and left
    // isActive=true describing the old one.
    const db = createMockDbService();

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { currentStageId: 'failed-passage' },
      {},
      TODAY,
    );

    expect(updateData(db)).toMatchObject({
      currentStageId: 'failed-passage',
      isDead: true,
      isActive: false,
    });
  });

  it('computes from the inputs the patch does not touch', async () => {
    // Only the stage changes; `status` still reads "Active Bill", so the
    // bill stays active — which the writer can only know from `current`.
    const db = createMockDbService();

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { currentStageId: 'passed_first_chamber' },
      {},
      TODAY,
    );

    expect(updateData(db)).toMatchObject({ isDead: false, isActive: true });
  });

  it('leaves an undefined input alone and clears a null one', async () => {
    const db = createMockDbService();

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { status: undefined, lastActionDate: null },
      {},
      TODAY,
    );

    const data = updateData(db);
    expect(data).not.toHaveProperty('status');
    expect(data.lastActionDate).toBeNull();
  });

  it('matches on the inputs it read, so a stale read cannot write', async () => {
    const db = createMockDbService();

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { currentStageId: 'chaptered' },
      {},
      TODAY,
    );

    expect(
      (db.bill.update.mock.calls[0][0] as { where: unknown }).where,
    ).toEqual({
      id: 'bill-1',
      status: activeBill.status,
      lastAction: activeBill.lastAction,
      lastActionDate: activeBill.lastActionDate,
      currentStageId: activeBill.currentStageId,
    });
  });

  it('re-reads and recomputes when the row changed underneath', async () => {
    // A concurrent sync marked the bill dead while the LLM ran; flags from
    // the stale read would have called it active again.
    const db = createMockDbService();
    db.bill.update
      .mockRejectedValueOnce({ code: 'P2025' })
      .mockResolvedValueOnce({} as never);
    db.bill.findUnique.mockResolvedValue({
      ...activeBill,
      status: 'Inactive Bill - Died',
    } as never);

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { currentStageId: 'in_committee' },
      {},
      TODAY,
    );

    expect(db.bill.update).toHaveBeenCalledTimes(2);
    expect(
      (db.bill.update.mock.calls[1][0] as { data: Record<string, unknown> })
        .data,
    ).toMatchObject({ isDead: true, isActive: false });
  });

  it('does nothing when the row was deleted underneath', async () => {
    const db = createMockDbService();
    db.bill.update.mockRejectedValueOnce({ code: 'P2025' });
    db.bill.findUnique.mockResolvedValue(null as never);

    await expect(
      writeBillLifecycleFields(db as never, activeBill, {}, {}, TODAY),
    ).resolves.toBeUndefined();
    expect(db.bill.update).toHaveBeenCalledTimes(1);
  });

  it('rethrows anything that is not a mismatch', async () => {
    const db = createMockDbService();
    db.bill.update.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      writeBillLifecycleFields(db as never, activeBill, {}, {}, TODAY),
    ).rejects.toThrow('connection lost');
  });

  it('writes the caller’s other columns in the same update', async () => {
    const db = createMockDbService();

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { currentStageId: 'chaptered', status: 'Chaptered' },
      { aiSummaryPromptHash: 'h1' },
      TODAY,
    );

    expect(db.bill.update).toHaveBeenCalledTimes(1);
    expect(updateData(db)).toMatchObject({
      aiSummaryPromptHash: 'h1',
      isDead: false,
      isActive: false,
    });
  });
});

describe('refreshBillLifecycleFlags (F4)', () => {
  /** One page of rows, then the end. */
  const withRows = (rows: object[]) => {
    const db = createMockDbService();
    db.bill.findMany
      .mockResolvedValueOnce(rows as never)
      .mockResolvedValueOnce([] as never);
    return db;
  };

  it('kills an unfinished bill once its session has closed', async () => {
    // The case nothing else catches: the 2025-26 session closes, the source
    // stops listing its bills, and no extraction ever rewrites them.
    const db = withRows([{ ...activeBill, isDead: false, isActive: true }]);

    const counts = await refreshBillLifecycleFlags(db as never, {
      today: new Date('2027-03-01T12:00:00Z'),
    });

    expect(db.bill.update).toHaveBeenCalledWith({
      // Conditional on the inputs and flags it read (see the next block).
      where: expect.objectContaining({
        id: 'bill-1',
        status: activeBill.status,
        isDead: false,
        isActive: true,
      }),
      data: { isDead: true, isActive: false },
    });
    expect(counts).toEqual({ scanned: 1, flippedDead: 1, flippedActive: 1 });
  });

  it('writes nothing for a row that is already right', async () => {
    const db = withRows([
      { ...activeBill, ...lifecycleFlags(activeBill, TODAY) },
    ]);

    const counts = await refreshBillLifecycleFlags(db as never, {
      today: TODAY,
    });

    expect(db.bill.update).not.toHaveBeenCalled();
    expect(counts.scanned).toBe(1);
  });

  it('skips a row that changed mid-page, and does not count it', async () => {
    const db = withRows([{ ...activeBill, isDead: false, isActive: true }]);
    db.bill.update.mockRejectedValueOnce({ code: 'P2025' });

    const counts = await refreshBillLifecycleFlags(db as never, {
      today: new Date('2027-03-01T12:00:00Z'),
    });

    expect(counts).toEqual({ scanned: 1, flippedDead: 0, flippedActive: 0 });
  });

  it('counts but does not write on a dry run', async () => {
    const db = withRows([{ ...activeBill, isDead: false, isActive: true }]);

    const counts = await refreshBillLifecycleFlags(db as never, {
      today: new Date('2027-03-01T12:00:00Z'),
      dryRun: true,
    });

    expect(db.bill.update).not.toHaveBeenCalled();
    expect(counts.flippedDead).toBe(1);
  });

  it('pages by cursor and scopes to the region', async () => {
    const db = createMockDbService();
    db.bill.findMany
      .mockResolvedValueOnce([
        { ...activeBill, id: 'a', ...lifecycleFlags(activeBill, TODAY) },
      ] as never)
      .mockResolvedValueOnce([
        { ...activeBill, id: 'b', ...lifecycleFlags(activeBill, TODAY) },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const counts = await refreshBillLifecycleFlags(db as never, {
      regionId: 'california',
      batchSize: 1,
      today: TODAY,
    });

    expect(counts.scanned).toBe(2);
    const second = db.bill.findMany.mock.calls[1][0] as {
      where: unknown;
      cursor: unknown;
    };
    expect(second.where).toEqual({ regionId: 'california' });
    expect(second.cursor).toEqual({ id: 'a' });
  });
});
