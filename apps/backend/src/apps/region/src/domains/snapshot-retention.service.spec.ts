import type { IStorageProvider } from '@opuspopuli/common';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { SnapshotRetentionService } from './snapshot-retention.service';

describe('SnapshotRetentionService', () => {
  let db: {
    bulkSnapshot: { findMany: jest.Mock; update: jest.Mock };
  };
  let storage: { deleteFile: jest.Mock };
  let service: SnapshotRetentionService;

  const row = (id: string, fetchedAt: string) => ({
    id,
    sourceUrl: 'https://netfile.com/export.zip',
    fetchedAt: new Date(fetchedAt),
    storageBucket: 'bulk-archives',
    storageKey: `bulk/aa/${id}`,
  });

  beforeEach(() => {
    db = {
      bulkSnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    storage = { deleteFile: jest.fn().mockResolvedValue(true) };
    service = new SnapshotRetentionService(
      db as unknown as DbService,
      storage as unknown as IStorageProvider,
    );
  });

  it('prunes payloads outside the schedule and keeps the newest', async () => {
    db.bulkSnapshot.findMany.mockResolvedValue([
      row('w1', '2026-09-01T00:00:00Z'),
      row('w2', '2026-09-08T00:00:00Z'),
      row('w3', '2026-09-22T00:00:00Z'),
    ]);

    const result = await service.sweep();

    expect(result).toEqual({ retained: 1, pruned: 2, failed: 0 });
    expect(storage.deleteFile).toHaveBeenCalledWith(
      'bulk-archives',
      'bulk/aa/w1',
    );
    expect(storage.deleteFile).not.toHaveBeenCalledWith(
      'bulk-archives',
      'bulk/aa/w3',
    );
  });

  it('keeps the row and only clears its payload', async () => {
    db.bulkSnapshot.findMany.mockResolvedValue([
      row('old', '2026-09-01T00:00:00Z'),
      row('new', '2026-09-22T00:00:00Z'),
    ]);

    await service.sweep();

    // A pruned snapshot must still name the export a finance row came from:
    // provenance resolves through the row, not through the bytes.
    const [call] = db.bulkSnapshot.update.mock.calls;
    expect(call[0].data).toEqual(
      expect.objectContaining({ storageKey: null, storageBucket: null }),
    );
    expect(call[0].data.prunedAt).toBeInstanceOf(Date);
  });

  it('does not mark a snapshot pruned when its payload could not be deleted', async () => {
    storage.deleteFile.mockResolvedValue(false);
    db.bulkSnapshot.findMany.mockResolvedValue([
      row('old', '2026-09-01T00:00:00Z'),
      row('new', '2026-09-22T00:00:00Z'),
    ]);

    const result = await service.sweep();

    // Marking it anyway would strand the object: nothing would reference it,
    // so nothing would retry, and the bytes this tier bounds would accumulate
    // invisibly.
    expect(result.failed).toBe(1);
    expect(result.pruned).toBe(0);
    expect(db.bulkSnapshot.update).not.toHaveBeenCalled();
  });

  it('survives a storage error without marking anything pruned', async () => {
    storage.deleteFile.mockRejectedValue(new Error('network down'));
    db.bulkSnapshot.findMany.mockResolvedValue([
      row('old', '2026-09-01T00:00:00Z'),
      row('new', '2026-09-22T00:00:00Z'),
    ]);

    const result = await service.sweep();

    expect(result.failed).toBe(1);
    expect(db.bulkSnapshot.update).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing to sweep', async () => {
    const result = await service.sweep();

    expect(result).toEqual({ retained: 0, pruned: 0, failed: 0 });
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('never prunes a lone snapshot', async () => {
    db.bulkSnapshot.findMany.mockResolvedValue([
      row('only', '2026-01-01T00:00:00Z'),
    ]);

    const result = await service.sweep();

    // However old it is, the only copy of a source is not surplus.
    expect(result.pruned).toBe(0);
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('refuses to sweep without a storage provider rather than losing track', async () => {
    const withoutStorage = new SnapshotRetentionService(
      db as unknown as DbService,
      null,
    );
    db.bulkSnapshot.findMany.mockResolvedValue([
      row('old', '2026-09-01T00:00:00Z'),
      row('new', '2026-09-22T00:00:00Z'),
    ]);

    const result = await withoutStorage.sweep();

    expect(result.pruned).toBe(0);
    expect(result.failed).toBe(1);
    expect(db.bulkSnapshot.update).not.toHaveBeenCalled();
  });

  it('only considers snapshots that still hold bytes', async () => {
    await service.sweep();

    expect(db.bulkSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { prunedAt: null, storageKey: { not: null } },
      }),
    );
  });
});
