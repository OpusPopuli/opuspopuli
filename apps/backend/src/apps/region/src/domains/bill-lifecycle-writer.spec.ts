import { createMockDbService } from '@opuspopuli/relationaldb-provider/testing';
import {
  flagsFor,
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
  statusSource: 'page',
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
      { today: TODAY },
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
      { today: TODAY },
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
      { today: TODAY },
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
      { today: TODAY },
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
      { today: TODAY },
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
      writeBillLifecycleFields(
        db as never,
        activeBill,
        {},
        {},
        { today: TODAY },
      ),
    ).resolves.toBe('gone');
    expect(db.bill.update).toHaveBeenCalledTimes(1);
  });

  it('skips instead of retrying when asked to, for a patch derived from the read', async () => {
    const db = createMockDbService();
    db.bill.update.mockRejectedValueOnce({ code: 'P2025' });

    await expect(
      writeBillLifecycleFields(
        db as never,
        activeBill,
        { currentStageId: 'failed-passage' },
        {},
        { today: TODAY, onConflict: 'skip' },
      ),
    ).resolves.toBe('changed-underneath');
    expect(db.bill.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a lifecycle field in extra, even in a non-literal object', () => {
    // TypeScript checks excess properties on literals only; the `never`
    // mapping is what catches a variable. Compile-time, so this test's job
    // is to fail `tsc` if the type loosens.
    const extra = { aiSummaryPromptHash: 'h', status: 'Died' };
    const db = createMockDbService();
    // @ts-expect-error — `status` is a lifecycle input
    void writeBillLifecycleFields(db as never, activeBill, {}, extra);
    const withSession = { sessionYear: '2023-2024' };
    // @ts-expect-error — `sessionYear` feeds the session-expired rule
    void writeBillLifecycleFields(db as never, activeBill, {}, withSession);
  });

  it('rethrows anything that is not a mismatch', async () => {
    const db = createMockDbService();
    db.bill.update.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      writeBillLifecycleFields(
        db as never,
        activeBill,
        {},
        {},
        { today: TODAY },
      ),
    ).rejects.toThrow('connection lost');
  });

  it('writes the caller’s other columns in the same update', async () => {
    const db = createMockDbService();

    await writeBillLifecycleFields(
      db as never,
      activeBill,
      { currentStageId: 'chaptered', status: 'Chaptered' },
      { aiSummaryPromptHash: 'h1' },
      { today: TODAY },
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
    expect(counts).toEqual({
      scanned: 1,
      flippedDead: 1,
      flippedActive: 1,
      changedUnderneath: 0,
    });
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

    expect(counts).toEqual({
      scanned: 1,
      flippedDead: 0,
      flippedActive: 0,
      changedUnderneath: 1,
    });
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

describe('flagsFor (bills-phase-b.md, B8)', () => {
  /** 2027: the 2025-2026 session has closed. */
  const NEXT_SESSION = new Date('2027-01-15T12:00:00Z');
  const stored = { isDead: false, isActive: true };

  it('recomputes a page-scraped row from its status', () => {
    expect(
      flagsFor({ ...activeBill, ...stored, status: 'Vetoed' }, TODAY),
    ).toEqual({ isDead: true, isActive: false });
  });

  it('never recomputes a legacy row from its status', () => {
    // The B8 shape: an LLM wrote a text-page label into `status`, which the
    // regex rules would read as "not Active Bill", so inactive.
    const legacy = {
      ...activeBill,
      ...stored,
      statusSource: null,
      status: 'Amended IN Assembly January 22, 2026',
    };
    expect(flagsFor(legacy, TODAY)).toEqual(stored);
  });

  it('leaves an official row as the bulk derive set it', () => {
    const official = {
      ...activeBill,
      ...stored,
      statusSource: 'official',
      status: 'In Committee Process',
    };
    expect(flagsFor(official, TODAY)).toEqual(stored);
  });

  it('ends an official row that is still active when its session closes', () => {
    const official = {
      ...activeBill,
      ...stored,
      statusSource: 'official',
      status: 'In Committee Process',
    };
    expect(flagsFor(official, NEXT_SESSION)).toEqual({
      isDead: true,
      isActive: false,
    });
  });

  it('keeps an enacted official row enacted after its session closes', () => {
    const enacted = {
      ...activeBill,
      statusSource: 'official',
      status: 'Chaptered',
      isDead: false,
      isActive: false,
    };
    expect(flagsFor(enacted, NEXT_SESSION)).toEqual({
      isDead: false,
      isActive: false,
    });
  });

  it('ends a legacy row that is still active when its session closes', () => {
    // The session rule reads no status, so it is safe on a legacy row; without
    // it a legacy bill no source lists any more stays active forever.
    const legacy = {
      ...activeBill,
      ...stored,
      statusSource: null,
      status: 'Amended IN Assembly January 22, 2026',
    };
    expect(flagsFor(legacy, NEXT_SESSION)).toEqual({
      isDead: true,
      isActive: false,
    });
  });

  it('refresh leaves a legacy row alone', async () => {
    const db = createMockDbService();
    db.bill.findMany
      .mockResolvedValueOnce([
        {
          ...activeBill,
          ...stored,
          statusSource: null,
          status: 'Introduced',
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const counts = await refreshBillLifecycleFlags(db as never, {
      today: TODAY,
    });

    expect(db.bill.update).not.toHaveBeenCalled();
    expect(counts.flippedActive).toBe(0);
  });
});
