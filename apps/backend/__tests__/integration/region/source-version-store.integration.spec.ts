/**
 * Integration test for the content-addressed source store (#1276).
 *
 * The unit spec asserts SourceVersionService's control flow against a mocked
 * DbService. That cannot see the thing most likely to be wrong: whether the
 * 20260918150000_source_version_store migration actually applied, whether
 * Prisma's field names map to the columns it created, and above all whether
 * dedup really holds — a unique index either rejects the second insert or it
 * does not, and a mock will happily agree either way.
 *
 * The acceptance criteria this drives, verbatim from the issue:
 *
 *   - a fetched artifact can be retrieved BY CONTENT HASH, with its
 *     fetchedAt / validators / producing run queryable
 *   - re-fetching unchanged content creates NO NEW STORED BYTES, demonstrated
 *     by a test rather than assumed
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { SourceVersionService } from '../../../src/apps/region/src/domains/source-version.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const BODY = Buffer.from(
  '<html><body>Measure A, full text</body></html>',
  'utf8',
);
const HASH = createHash('sha256').update(BODY).digest('hex');
const URL = 'https://example.gov/measures/a';

describe('source version store (#1276)', () => {
  let db: DbService;
  let service: SourceVersionService;

  beforeAll(async () => {
    db = await getDbService();
    service = new SourceVersionService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('stores a fetched artifact and retrieves it by content hash', async () => {
    const result = await service.record({
      content: BODY,
      contentHash: HASH,
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: URL,
      contentType: 'text/html',
      etag: '"v1"',
      lastModified: 'Wed, 17 Sep 2026 10:00:00 GMT',
      regionId: 'us-ca',
      dataType: 'propositions',
    });

    expect(result).toEqual({ contentHash: HASH, stored: true });

    const stored = await service.getByHash(HASH);

    expect(stored).not.toBeNull();
    // The bytes survive the BYTEA round-trip unchanged — the whole premise of
    // a content address is that what comes back out still hashes to the key.
    expect(stored!.content.equals(BODY)).toBe(true);
    expect(createHash('sha256').update(stored!.content).digest('hex')).toBe(
      HASH,
    );
    expect(stored!.byteSize).toBe(BODY.length);
    expect(stored!.fetchedAt.toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(stored!.etag).toBe('"v1"');
    expect(stored!.lastModified).toBe('Wed, 17 Sep 2026 10:00:00 GMT');
    expect(stored!.sourceUrl).toBe(URL);
  });

  it('stores no new bytes when unchanged content is re-fetched', async () => {
    await service.record({
      content: BODY,
      contentHash: HASH,
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: URL,
    });

    // Same bytes, later fetch — a re-scrape that found nothing changed.
    const second = await service.record({
      content: Buffer.from(BODY),
      contentHash: HASH,
      fetchedAt: '2026-09-18T12:00:00.000Z',
      sourceUrl: URL,
    });

    expect(second).toEqual({ contentHash: HASH, stored: false });

    const rows = await db.sourceVersion.findMany({
      where: { contentHash: HASH },
    });
    expect(rows).toHaveLength(1);
    // First capture wins: the row still describes the fetch that stored it.
    expect(rows[0].fetchedAt.toISOString()).toBe('2026-09-18T10:00:00.000Z');
  });

  it('stores a new version when the source content changes', async () => {
    const changed = Buffer.from(
      '<html><body>Measure A, amended text</body></html>',
      'utf8',
    );
    const changedHash = createHash('sha256').update(changed).digest('hex');

    await service.record({
      content: BODY,
      contentHash: HASH,
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: URL,
    });
    await service.record({
      content: changed,
      contentHash: changedHash,
      fetchedAt: '2026-09-18T12:00:00.000Z',
      sourceUrl: URL,
    });

    // Both versions remain — this is what lets a claim be checked against the
    // text as it stood, rather than against whatever the page says now.
    const versions = await db.sourceVersion.findMany({
      where: { sourceUrl: URL },
      orderBy: { fetchedAt: 'asc' },
    });

    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.contentHash)).toEqual([HASH, changedHash]);
  });

  it('rejects a duplicate content hash at the database level', async () => {
    await service.record({
      content: BODY,
      contentHash: HASH,
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: URL,
    });

    // Bypass the service entirely: the guarantee must come from the unique
    // index, not from the service remembering to check first.
    await expect(
      db.sourceVersion.create({
        data: {
          contentHash: HASH,
          content: BODY,
          byteSize: BODY.length,
          sourceUrl: 'https://elsewhere.gov/copy',
          fetchedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('links a stored artifact to the run that produced it', async () => {
    const execution = await db.pipelineExecution.create({
      data: {
        regionId: 'us-ca',
        sourceUrl: URL,
        dataType: 'propositions',
      },
    });

    await service.record({
      content: BODY,
      contentHash: HASH,
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: URL,
      executionId: execution.id,
    });

    const provenance = await service.getProvenance(HASH);
    expect(provenance!.executionId).toBe(execution.id);
  });

  it('keeps the artifact when the run that fetched it is deleted', async () => {
    const execution = await db.pipelineExecution.create({
      data: {
        regionId: 'us-ca',
        sourceUrl: URL,
        dataType: 'propositions',
      },
    });
    await service.record({
      content: BODY,
      contentHash: HASH,
      fetchedAt: '2026-09-18T10:00:00.000Z',
      sourceUrl: URL,
      executionId: execution.id,
    });

    await db.pipelineExecution.delete({ where: { id: execution.id } });

    // ON DELETE SET NULL, not CASCADE: pruning pipeline bookkeeping must never
    // silently delete evidence a claim depends on.
    const survived = await service.getByHash(HASH);
    expect(survived).not.toBeNull();
    expect(survived!.executionId).toBeNull();
  });
});
