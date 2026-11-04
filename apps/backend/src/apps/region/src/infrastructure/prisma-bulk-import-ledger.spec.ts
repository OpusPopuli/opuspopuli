import type { DbService } from '@opuspopuli/relationaldb-provider';
import { PrismaBulkImportLedger } from './prisma-bulk-import-ledger';

describe('PrismaBulkImportLedger (campaign-finance-phase-b.md, D3)', () => {
  let bulkImport: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  let ledger: PrismaBulkImportLedger;

  beforeEach(() => {
    bulkImport = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    ledger = new PrismaBulkImportLedger({ bulkImport } as unknown as DbService);
  });

  it('reads the key of the last completed import', async () => {
    bulkImport.findUnique.mockResolvedValue({ importKey: 'k1' });

    await expect(ledger.lastCompletedKey('src')).resolves.toBe('k1');
    expect(bulkImport.findUnique).toHaveBeenCalledWith({
      where: { sourceKey: 'src' },
      select: { importKey: true },
    });
  });

  it('answers "nothing completed" for a source never imported', async () => {
    await expect(ledger.lastCompletedKey('src')).resolves.toBeUndefined();
  });

  it('answers "nothing completed" when the ledger cannot be read', async () => {
    // The safe answer: every row is written.
    bulkImport.findUnique.mockRejectedValue(new Error('db down'));

    await expect(ledger.lastCompletedKey('src')).resolves.toBeUndefined();
  });

  it('records a completed import, replacing the previous one', async () => {
    await ledger.recordCompleted('src', 'k2', 'exec-1');

    const args = bulkImport.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ sourceKey: 'src' });
    expect(args.create).toMatchObject({
      sourceKey: 'src',
      importKey: 'k2',
      executionId: 'exec-1',
    });
    expect(args.update).toMatchObject({
      importKey: 'k2',
      executionId: 'exec-1',
    });
    expect(args.update.completedAt).toBeInstanceOf(Date);
  });

  it('does not throw when the write fails', async () => {
    bulkImport.upsert.mockRejectedValue(new Error('db down'));

    await expect(
      ledger.recordCompleted('src', 'k2', null),
    ).resolves.toBeUndefined();
  });

  it('forgets a source, so nothing is skipped until it completes again', async () => {
    await ledger.forget('src');

    expect(bulkImport.deleteMany).toHaveBeenCalledWith({
      where: { sourceKey: 'src' },
    });
  });

  it('does not throw when forgetting fails', async () => {
    bulkImport.deleteMany.mockRejectedValue(new Error('db down'));

    await expect(ledger.forget('src')).resolves.toBeUndefined();
  });
});
