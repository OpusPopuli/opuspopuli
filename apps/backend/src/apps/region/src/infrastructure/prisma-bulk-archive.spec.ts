import { ConfigService } from '@nestjs/config';
import type { IStorageProvider } from '@opuspopuli/common';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import type { BulkSnapshotCandidate } from '@opuspopuli/scraping-pipeline';
import {
  PrismaBulkArchive,
  DEFAULT_ARCHIVE_BUCKET,
} from './prisma-bulk-archive';

describe('PrismaBulkArchive', () => {
  let db: { bulkSnapshot: { findUnique: jest.Mock; create: jest.Mock } };
  let storage: { putStream: jest.Mock };
  let archive: PrismaBulkArchive;

  const candidate = (
    overrides: Partial<BulkSnapshotCandidate> = {},
  ): BulkSnapshotCandidate => ({
    contentHash: 'a'.repeat(64),
    sourceUrl: 'https://netfile.com/export.zip',
    byteSize: 1_073_741_824,
    fetchedAt: '2026-09-19T10:00:00.000Z',
    contentType: 'application/zip',
    regionId: 'us-ca',
    dataType: 'campaign_finance',
    executionId: 'exec-1',
    openStream: () => ({}) as NodeJS.ReadableStream,
    ...overrides,
  });

  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    db = {
      bulkSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    storage = { putStream: jest.fn().mockResolvedValue(undefined) };
    archive = new PrismaBulkArchive(
      db as unknown as DbService,
      storage as unknown as IStorageProvider,
      config,
    );
  });

  it('uploads the payload and records the snapshot', async () => {
    await archive.archive(candidate());

    expect(storage.putStream).toHaveBeenCalledWith(
      DEFAULT_ARCHIVE_BUCKET,
      `bulk/aa/${'a'.repeat(64)}`,
      expect.any(Function),
      expect.objectContaining({ contentLength: 1_073_741_824 }),
    );
    expect(db.bulkSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentHash: 'a'.repeat(64),
        storageBucket: DEFAULT_ARCHIVE_BUCKET,
        executionId: 'exec-1',
      }),
    });
  });

  it('stores byteSize as a BigInt', async () => {
    await archive.archive(candidate({ byteSize: 3_221_225_472 }));

    // The column is BIGINT because this describes bulk exports and INT4 tops
    // out at 2.1 GB. Passing a plain number would throw at the driver.
    const [{ data }] = db.bulkSnapshot.create.mock.calls[0];
    expect(typeof data.byteSize).toBe('bigint');
    expect(data.byteSize).toBe(3_221_225_472n);
  });

  it('records the snapshot even when the upload fails', async () => {
    storage.putStream.mockRejectedValue(new Error('Payload too large'));

    await archive.archive(candidate());

    // Provenance resolves through the row, not through the bytes
    // (row -> execution <- snapshot). Skipping the row on an upload failure
    // would break that chain for every row in the run — and Supabase Storage's
    // default 50 MB limit makes this a live possibility, not a theoretical one.
    const [{ data }] = db.bulkSnapshot.create.mock.calls[0];
    expect(data.storageKey).toBeNull();
    expect(data.storageBucket).toBeNull();
    expect(data.contentHash).toBe('a'.repeat(64));
  });

  it('records the snapshot when no provider can accept an upload', async () => {
    const withoutStorage = new PrismaBulkArchive(
      db as unknown as DbService,
      null,
      config,
    );

    await withoutStorage.archive(candidate());

    const [{ data }] = db.bulkSnapshot.create.mock.calls[0];
    expect(data.storageKey).toBeNull();
  });

  it('stores nothing new when the same export is re-fetched', async () => {
    db.bulkSnapshot.findUnique.mockResolvedValue({ id: 'existing' });

    await archive.archive(candidate());

    // Content-addressed: cost tracks how often the export changes, not how
    // often it is downloaded. Re-uploading a gigabyte would defeat that.
    expect(storage.putStream).not.toHaveBeenCalled();
    expect(db.bulkSnapshot.create).not.toHaveBeenCalled();
  });

  it('shards the storage key on the hash prefix', async () => {
    await archive.archive(candidate({ contentHash: 'bc' + 'd'.repeat(62) }));

    const [, key] = storage.putStream.mock.calls[0];
    expect(key).toBe(`bulk/bc/bc${'d'.repeat(62)}`);
  });
});
