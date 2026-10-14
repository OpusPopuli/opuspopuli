import { ConfigService } from '@nestjs/config';
import type { IStorageProvider } from '@opuspopuli/common';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import type { BulkSnapshotCandidate } from '@opuspopuli/scraping-pipeline';
import {
  PrismaBulkArchive,
  DEFAULT_ARCHIVE_BUCKET,
} from './prisma-bulk-archive';

describe('PrismaBulkArchive', () => {
  let db: {
    bulkSnapshot: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
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
    lastModified: 'Tue, 13 Oct 2026 08:59:20 GMT',
    etag: '"0b1e6b2c6c702da86bd3a5b440948647-153"',
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
        update: jest.fn().mockResolvedValue({}),
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

  it('records the publication date and etag the server sent (#991)', async () => {
    // `bulk_snapshots.last_modified` had been null on every row since the
    // column was added (#1277): neither this class nor the download handler
    // ever read the header. #991 shows it to readers as `asOfSource`, so a
    // funding figure could never be tied to a snapshot of the public record
    // — the page always said it could not be dated.
    await archive.archive(candidate());

    expect(db.bulkSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastModified: 'Tue, 13 Oct 2026 08:59:20 GMT',
          etag: '"0b1e6b2c6c702da86bd3a5b440948647-153"',
        }),
      }),
    );
  });

  it('stores an absent header as null rather than undefined', async () => {
    await archive.archive(
      candidate({ lastModified: undefined, etag: undefined }),
    );

    const { data } = db.bulkSnapshot.create.mock.calls[0][0];
    expect(data.lastModified).toBeNull();
    expect(data.etag).toBeNull();
  });

  it('backfills provenance onto a row archived before it was captured (#991)', async () => {
    // The dedupe is on content hash, so the same export re-fetched is
    // "unchanged" and an early return would make those nulls PERMANENT —
    // the figure could never be dated, however many syncs ran.
    db.bulkSnapshot.findUnique.mockResolvedValue({
      id: 'existing',
      lastModified: null,
      etag: null,
    });

    await archive.archive(candidate());

    expect(db.bulkSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: {
        lastModified: 'Tue, 13 Oct 2026 08:59:20 GMT',
        etag: '"0b1e6b2c6c702da86bd3a5b440948647-153"',
      },
    });
    expect(db.bulkSnapshot.create).not.toHaveBeenCalled();
  });

  it('does not overwrite provenance already recorded', async () => {
    db.bulkSnapshot.findUnique.mockResolvedValue({
      id: 'existing',
      lastModified: 'Mon, 12 Oct 2026 08:52:56 GMT',
      etag: '"older"',
    });

    await archive.archive(candidate());

    // Identical bytes by definition here, so a differing header is the less
    // trustworthy of the two. Fill a null; never replace a value.
    expect(db.bulkSnapshot.update).not.toHaveBeenCalled();
    expect(db.bulkSnapshot.create).not.toHaveBeenCalled();
  });

  it('stores nothing new when the same export is re-fetched', async () => {
    db.bulkSnapshot.findUnique.mockResolvedValue({
      id: 'existing',
      lastModified: 'Tue, 13 Oct 2026 08:59:20 GMT',
      etag: '"x"',
    });

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
