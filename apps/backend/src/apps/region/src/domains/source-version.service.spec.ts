import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  SourceVersionService,
  MAX_ARCHIVED_BYTES,
  type RecordSourceInput,
} from './source-version.service';

describe('SourceVersionService', () => {
  let service: SourceVersionService;
  let db: {
    sourceVersion: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  const input = (
    overrides: Partial<RecordSourceInput> = {},
  ): RecordSourceInput => ({
    content: Buffer.from('<html>Measure A</html>', 'utf8'),
    contentHash: 'a'.repeat(64),
    fetchedAt: '2026-09-18T10:00:00.000Z',
    sourceUrl: 'https://example.gov/measures/a',
    ...overrides,
  });

  beforeEach(async () => {
    db = {
      sourceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module = await Test.createTestingModule({
      providers: [SourceVersionService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get(SourceVersionService);
  });

  describe('record', () => {
    it('stores an artifact that has not been seen before', async () => {
      const result = await service.record(input());

      expect(result).toEqual({ contentHash: 'a'.repeat(64), stored: true });
      expect(db.sourceVersion.create).toHaveBeenCalledTimes(1);
    });

    it('persists the provenance captured at fetch time', async () => {
      await service.record(
        input({
          contentType: 'text/html',
          etag: '"v1"',
          lastModified: 'Wed, 17 Sep 2026 10:00:00 GMT',
          regionId: 'us-ca',
          dataType: 'propositions',
          executionId: 'exec-1',
          manifestId: 'manifest-1',
        }),
      );

      expect(db.sourceVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentHash: 'a'.repeat(64),
          byteSize: 22,
          contentType: 'text/html',
          sourceUrl: 'https://example.gov/measures/a',
          fetchedAt: new Date('2026-09-18T10:00:00.000Z'),
          etag: '"v1"',
          lastModified: 'Wed, 17 Sep 2026 10:00:00 GMT',
          regionId: 'us-ca',
          dataType: 'propositions',
          executionId: 'exec-1',
          manifestId: 'manifest-1',
        }),
      });
    });

    it('stores nothing when the same bytes are already archived', async () => {
      db.sourceVersion.findUnique.mockResolvedValue({ id: 'existing' });

      const result = await service.record(input());

      // The dedup that makes the store cost track change rather than
      // fetch frequency — an unchanged re-fetch must not write.
      expect(result).toEqual({ contentHash: 'a'.repeat(64), stored: false });
      expect(db.sourceVersion.create).not.toHaveBeenCalled();
    });

    it('treats a concurrent insert of the same bytes as a no-op', async () => {
      db.sourceVersion.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const result = await service.record(input());

      // Two runs fetching the same unchanged page is normal, not an error:
      // the winner's row holds identical bytes, because the hash is the key.
      expect(result).toEqual({ contentHash: 'a'.repeat(64), stored: false });
    });

    it('rethrows failures that are not a duplicate', async () => {
      db.sourceVersion.create.mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(service.record(input())).rejects.toThrow('connection lost');
    });

    it('refuses a body over the archive cap, without truncating it', async () => {
      const oversized = Buffer.alloc(MAX_ARCHIVED_BYTES + 1, 0x41);

      const result = await service.record(input({ content: oversized }));

      // Truncating would store half a document under a hash claiming to be
      // the whole thing — it would verify, which is worse than no archive.
      expect(result.stored).toBe(false);
      expect(result.skippedReason).toBe('too-large');
      expect(db.sourceVersion.create).not.toHaveBeenCalled();
    });

    it('accepts a body exactly at the cap', async () => {
      const atLimit = Buffer.alloc(MAX_ARCHIVED_BYTES, 0x41);

      const result = await service.record(input({ content: atLimit }));

      expect(result.stored).toBe(true);
    });

    it('skips an empty body', async () => {
      const result = await service.record(input({ content: Buffer.alloc(0) }));

      expect(result).toEqual({
        contentHash: 'a'.repeat(64),
        stored: false,
        skippedReason: 'empty',
      });
      expect(db.sourceVersion.create).not.toHaveBeenCalled();
    });

    it('does not probe the database for a body it will refuse', async () => {
      await service.record(
        input({ content: Buffer.alloc(MAX_ARCHIVED_BYTES + 1, 0x41) }),
      );

      expect(db.sourceVersion.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getProvenance', () => {
    it('does not select the payload', async () => {
      await service.getProvenance('a'.repeat(64));

      const [[args]] = db.sourceVersion.findUnique.mock.calls;
      expect(args.select).toBeDefined();
      expect(args.select.content).toBeUndefined();
    });
  });
});
