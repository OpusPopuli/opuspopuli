/**
 * Integration test for source-store gauges (#1278).
 *
 * The unit spec drives the service against a mocked DbService, which can
 * verify the control flow but not the thing these gauges are actually made of:
 * two raw SQL aggregates, one of which asks Postgres how much space a column
 * really occupies. `pg_column_size` has no meaning against a mock, and the
 * compression ratio it produces is the number this issue chose to report
 * instead of adding compression of its own.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import type { Gauge } from 'prom-client';
import {
  SourceStoreMetricsService,
  TIER_BULK,
  TIER_CITED,
} from '../../../src/apps/region/src/domains/source-store-metrics.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

describe('source store metrics (#1278)', () => {
  let db: DbService;
  let bytes: { set: jest.Mock };
  let objects: { set: jest.Mock };
  let ratio: { set: jest.Mock };
  let freshness: { set: jest.Mock };
  let service: SourceStoreMetricsService;

  /** Compressible text, the shape civic HTML actually has. */
  function page(id: string): Buffer {
    const body = Array.from(
      { length: 400 },
      (_, i) =>
        `<li class="measure"><a href="/initiative/${id}-${i}">Measure ${i}</a></li>`,
    ).join('\n');
    return Buffer.from(`<html><body><ul>${body}</ul></body></html>`, 'utf8');
  }

  function valueOf(
    gauge: { set: jest.Mock },
    labels: Record<string, string>,
  ): number | undefined {
    const call = gauge.set.mock.calls.find(([l]) =>
      Object.entries(labels).every(([k, v]) => l[k] === v),
    );
    return call?.[1];
  }

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    bytes = { set: jest.fn() };
    objects = { set: jest.fn() };
    ratio = { set: jest.fn() };
    freshness = { set: jest.fn() };
    service = new SourceStoreMetricsService(
      db,
      bytes as unknown as Gauge<string>,
      objects as unknown as Gauge<string>,
      ratio as unknown as Gauge<string>,
      freshness as unknown as Gauge<string>,
    );
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('reports zero for an empty store without dividing by zero', async () => {
    await service.collect();

    // The state on the day this ships. A crash here would mean the gauges
    // only work once there is data, which is the opposite of the point.
    expect(valueOf(bytes, { tier: TIER_CITED, location: 'postgres' })).toBe(0);
    expect(valueOf(objects, { tier: TIER_CITED, state: 'present' })).toBe(0);
    expect(valueOf(ratio, { tier: TIER_CITED, method: 'toast' })).toBe(1);
  });

  it('measures the compression Postgres is already doing', async () => {
    const content = page('prop-1');
    await db.sourceVersion.create({
      data: {
        contentHash: createHash('sha256').update(content).digest('hex'),
        content,
        byteSize: content.length,
        sourceUrl: 'https://oag.ca.gov/initiatives',
        fetchedAt: new Date(),
      },
    });

    await service.collect();

    const logical = valueOf(bytes, { tier: TIER_CITED, location: 'logical' })!;
    const stored = valueOf(bytes, { tier: TIER_CITED, location: 'postgres' })!;
    const achieved = valueOf(ratio, { tier: TIER_CITED, method: 'toast' })!;

    // TOAST compresses this for free. Measured at 3.15x on a real CA AG page,
    // which is why #1278 reports the ratio rather than adding zstd on top —
    // pre-compressed bytes would disable TOAST and net far less than the
    // headline 5-10x the issue assumed.
    expect(logical).toBe(content.length);
    expect(stored).toBeLessThan(logical);
    expect(achieved).toBeGreaterThan(1);
    expect(achieved).toBeCloseTo(logical / stored, 5);
  });

  it('counts bulk snapshots by what they actually hold', async () => {
    const base = {
      sourceUrl: 'https://netfile.com/export.zip',
      byteSize: BigInt(1_073_741_824),
      fetchedAt: new Date(),
    };
    await db.bulkSnapshot.create({
      data: {
        ...base,
        contentHash: 'a'.repeat(64),
        storageBucket: 'bulk-archives',
        storageKey: 'bulk/aa/present',
      },
    });
    await db.bulkSnapshot.create({
      data: { ...base, contentHash: 'b'.repeat(64), prunedAt: new Date() },
    });
    await db.bulkSnapshot.create({
      data: { ...base, contentHash: 'c'.repeat(64) },
    });

    await service.collect();

    // Three rows, three different meanings. Only one is holding bytes; the
    // pruned row survives its payload by design, and the third was recorded
    // but never uploaded — the outcome a 50 MB bucket limit produces against
    // a ~1 GB export.
    expect(valueOf(objects, { tier: TIER_BULK, state: 'present' })).toBe(1);
    expect(valueOf(objects, { tier: TIER_BULK, state: 'pruned' })).toBe(1);
    expect(valueOf(objects, { tier: TIER_BULK, state: 'unstored' })).toBe(1);
  });

  it('counts only bytes it still holds', async () => {
    const base = {
      sourceUrl: 'https://netfile.com/export.zip',
      byteSize: BigInt(1_073_741_824),
      fetchedAt: new Date(),
    };
    await db.bulkSnapshot.create({
      data: {
        ...base,
        contentHash: 'a'.repeat(64),
        storageBucket: 'bulk-archives',
        storageKey: 'bulk/aa/present',
      },
    });
    await db.bulkSnapshot.create({
      data: { ...base, contentHash: 'b'.repeat(64), prunedAt: new Date() },
    });

    await service.collect();

    // A pruned snapshot's bytes are gone. Counting its recorded size would
    // report storage that was already reclaimed, and a capacity graph that
    // only goes up is worse than none.
    expect(
      valueOf(bytes, { tier: TIER_BULK, location: 'object-storage' }),
    ).toBe(1_073_741_824);
  });

  it('handles a byte total beyond INT4', async () => {
    await db.bulkSnapshot.create({
      data: {
        contentHash: 'd'.repeat(64),
        sourceUrl: 'https://netfile.com/export.zip',
        byteSize: BigInt('4294967296'),
        fetchedAt: new Date(),
        storageBucket: 'bulk-archives',
        storageKey: 'bulk/dd/big',
      },
    });

    await service.collect();

    // 4 GB. The sum crosses INT4 and arrives as a BigInt; a Prometheus gauge
    // is a float64, exact to 2^53 bytes.
    expect(
      valueOf(bytes, { tier: TIER_BULK, location: 'object-storage' }),
    ).toBe(4294967296);
  });

  it('publishes a fresh measurement timestamp per tier', async () => {
    const before = Math.floor(Date.now() / 1000);

    await service.collect();

    expect(valueOf(freshness, { tier: TIER_CITED })).toBeGreaterThanOrEqual(
      before,
    );
    expect(valueOf(freshness, { tier: TIER_BULK })).toBeGreaterThanOrEqual(
      before,
    );
  });
});
