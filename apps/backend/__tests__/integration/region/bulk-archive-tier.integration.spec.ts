/**
 * Integration test for the bulk-archive tier (#1277).
 *
 * The acceptance criterion that matters most here is a claim about what
 * survives: "a finance row's provenance resolves without the original ZIP."
 * That is only true if the snapshot row outlives its payload and the join from
 * row to run to snapshot still works after a prune — none of which a mocked
 * DbService can demonstrate.
 *
 * Also drives the retention schedule itself against real rows, because an
 * off-by-one there deletes the newest export rather than the oldest.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { SnapshotRetentionService } from '../../../src/apps/region/src/domains/snapshot-retention.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const EXPORT_URL = 'https://netfile.com/export.zip';

function hashOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('bulk archive tier (#1277)', () => {
  let db: DbService;
  let executionId: string;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const execution = await db.pipelineExecution.create({
      data: {
        regionId: 'us-ca',
        sourceUrl: EXPORT_URL,
        dataType: 'campaign_finance',
      },
    });
    executionId = execution.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createSnapshot(
    id: string,
    fetchedAt: string,
    withPayload = true,
  ) {
    return db.bulkSnapshot.create({
      data: {
        contentHash: hashOf(id),
        sourceUrl: EXPORT_URL,
        regionId: 'us-ca',
        dataType: 'campaign_finance',
        byteSize: BigInt(1_073_741_824),
        fetchedAt: new Date(fetchedAt),
        executionId,
        ...(withPayload
          ? { storageBucket: 'bulk-archives', storageKey: `bulk/xx/${id}` }
          : {}),
      },
    });
  }

  it('resolves a finance row to its export after the payload is pruned', async () => {
    const snapshot = await createSnapshot('snap-1', '2026-09-01T00:00:00Z');
    const line = 'C001,Jane Doe,500';
    await db.contribution.create({
      data: {
        externalId: 'contrib-1',
        amount: 500,
        donorName: 'Jane Doe',
        donorType: 'IND',
        date: new Date('2026-09-01'),
        sourceSystem: 'netfile',
        pipelineExecutionId: executionId,
        sourceRecordHash: hashOf(line),
      },
    });

    // Prune the payload the way the sweep does: bytes gone, row retained.
    await db.bulkSnapshot.update({
      where: { id: snapshot.id },
      data: { prunedAt: new Date(), storageBucket: null, storageKey: null },
    });

    // The whole point of the tier: row -> execution <- snapshot still answers
    // "which export did this row come from", with no ZIP anywhere.
    const row = await db.contribution.findFirst({
      where: { externalId: 'contrib-1' },
      select: { sourceRecordHash: true, pipelineExecutionId: true },
    });
    const origin = await db.bulkSnapshot.findFirst({
      where: { executionId: row!.pipelineExecutionId! },
      select: {
        contentHash: true,
        sourceUrl: true,
        fetchedAt: true,
        prunedAt: true,
      },
    });

    expect(origin).not.toBeNull();
    expect(origin!.sourceUrl).toBe(EXPORT_URL);
    expect(origin!.prunedAt).not.toBeNull();
    expect(row!.sourceRecordHash).toBe(hashOf(line));
  });

  it('keeps the newest snapshot and prunes the rest of its month', async () => {
    await createSnapshot('w1', '2026-09-01T00:00:00Z');
    await createSnapshot('w2', '2026-09-08T00:00:00Z');
    await createSnapshot('w3', '2026-09-22T00:00:00Z');

    const service = new SnapshotRetentionService(db, {
      deleteFile: async () => true,
    } as never);
    const result = await service.sweep();

    expect(result).toEqual({ retained: 1, pruned: 2, failed: 0 });

    const survivor = await db.bulkSnapshot.findFirst({
      where: { storageKey: { not: null } },
      select: { contentHash: true },
    });
    expect(survivor!.contentHash).toBe(hashOf('w3'));
  });

  it('never deletes a snapshot row, only its payload', async () => {
    await createSnapshot('w1', '2026-09-01T00:00:00Z');
    await createSnapshot('w2', '2026-09-22T00:00:00Z');

    const service = new SnapshotRetentionService(db, {
      deleteFile: async () => true,
    } as never);
    await service.sweep();

    // Dropping the row to reclaim a few hundred bytes would break the
    // provenance chain the payload existed to support.
    expect(await db.bulkSnapshot.count()).toBe(2);
  });

  it('keeps one snapshot per calendar month', async () => {
    await createSnapshot('jul-a', '2026-07-02T00:00:00Z');
    await createSnapshot('jul-b', '2026-07-28T00:00:00Z');
    await createSnapshot('aug', '2026-08-15T00:00:00Z');
    await createSnapshot('sep', '2026-09-22T00:00:00Z');

    const service = new SnapshotRetentionService(db, {
      deleteFile: async () => true,
    } as never);
    const result = await service.sweep();

    const retained = await db.bulkSnapshot.findMany({
      where: { storageKey: { not: null } },
      select: { contentHash: true },
    });

    expect(result.pruned).toBe(1);
    expect(retained.map((r) => r.contentHash).sort()).toEqual(
      [hashOf('jul-b'), hashOf('aug'), hashOf('sep')].sort(),
    );
  });

  it('stores a byte size larger than INT4 can hold', async () => {
    await db.bulkSnapshot.create({
      data: {
        contentHash: hashOf('huge'),
        sourceUrl: EXPORT_URL,
        byteSize: BigInt('3221225472'),
        fetchedAt: new Date(),
      },
    });

    const stored = await db.bulkSnapshot.findFirst({
      where: { contentHash: hashOf('huge') },
      select: { byteSize: true },
    });

    // 3 GB. A column describing bulk exports should not top out at 2.1 GB.
    expect(stored!.byteSize).toBe(3221225472n);
  });

  it('rejects a second snapshot of byte-identical content', async () => {
    await createSnapshot('dup', '2026-09-01T00:00:00Z');

    // Content-addressed: re-fetching an unchanged gigabyte must not store a
    // second copy.
    await expect(
      db.bulkSnapshot.create({
        data: {
          contentHash: hashOf('dup'),
          sourceUrl: EXPORT_URL,
          byteSize: BigInt(1),
          fetchedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
