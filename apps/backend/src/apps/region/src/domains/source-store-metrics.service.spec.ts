import type { DbService } from '@opuspopuli/relationaldb-provider';
import type { Gauge } from 'prom-client';
import {
  SourceStoreMetricsService,
  TIER_BULK,
  TIER_CITED,
} from './source-store-metrics.service';

describe('SourceStoreMetricsService', () => {
  let db: { $queryRaw: jest.Mock };
  let bytes: { set: jest.Mock };
  let objects: { set: jest.Mock };
  let ratio: { set: jest.Mock };
  let freshness: { set: jest.Mock };
  let service: SourceStoreMetricsService;

  const citedRow = {
    logical_bytes: 49695n,
    stored_bytes: 15772n,
    objects: 1n,
  };
  const bulkRow = {
    stored_bytes: 1073741824n,
    present: 1n,
    pruned: 2n,
    unstored: 0n,
  };

  function gaugeValue(
    gauge: { set: jest.Mock },
    labels: Record<string, string>,
  ): number | undefined {
    const call = gauge.set.mock.calls.find(([l]) =>
      Object.entries(labels).every(([k, v]) => l[k] === v),
    );
    return call?.[1];
  }

  beforeEach(() => {
    db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([citedRow])
        .mockResolvedValueOnce([bulkRow]),
    };
    bytes = { set: jest.fn() };
    objects = { set: jest.fn() };
    ratio = { set: jest.fn() };
    freshness = { set: jest.fn() };

    service = new SourceStoreMetricsService(
      db as unknown as DbService,
      bytes as unknown as Gauge<string>,
      objects as unknown as Gauge<string>,
      ratio as unknown as Gauge<string>,
      freshness as unknown as Gauge<string>,
    );
  });

  it('reports the two tiers separately', async () => {
    await service.collect();

    // An aggregate would hide which tier is growing, which is the only
    // question these gauges exist to answer: the tiers have different
    // retention policies, so their growth means different things.
    expect(gaugeValue(bytes, { tier: TIER_CITED, location: 'postgres' })).toBe(
      15772,
    );
    expect(
      gaugeValue(bytes, { tier: TIER_BULK, location: 'object-storage' }),
    ).toBe(1073741824);
  });

  it('reports the compression Postgres is already achieving', async () => {
    await service.collect();

    // 49695 / 15772 = 3.15x, from TOAST, with no code. Measuring it is what
    // replaced adding app-level compression in this issue's scope.
    expect(
      gaugeValue(ratio, { tier: TIER_CITED, method: 'toast' }),
    ).toBeCloseTo(3.15, 2);
  });

  it('counts pruned snapshots apart from present ones', async () => {
    await service.collect();

    // Pruned rows survive on purpose. Counting them as present would report
    // bytes the store is not actually holding.
    expect(gaugeValue(objects, { tier: TIER_BULK, state: 'present' })).toBe(1);
    expect(gaugeValue(objects, { tier: TIER_BULK, state: 'pruned' })).toBe(2);
  });

  it('surfaces snapshots recorded without their bytes', async () => {
    db.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([citedRow])
      .mockResolvedValueOnce([{ ...bulkRow, unstored: 7n }]);

    await service.collect();

    // On a Supabase-backed deployment the 50 MB per-file limit makes this the
    // expected outcome for a ~1 GB export. It must be visible rather than
    // looking like an empty tier.
    expect(gaugeValue(objects, { tier: TIER_BULK, state: 'unstored' })).toBe(7);
  });

  it('publishes a measurement timestamp for each tier', async () => {
    await service.collect();

    // A gauge that stops updating keeps reporting its last value forever,
    // which is how #1217 stayed invisible for 49 days — the number looked
    // fine because it was stale.
    expect(gaugeValue(freshness, { tier: TIER_CITED })).toBeGreaterThan(0);
    expect(gaugeValue(freshness, { tier: TIER_BULK })).toBeGreaterThan(0);
  });

  it('reports an empty store as zero bytes and a neutral ratio', async () => {
    db.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        { logical_bytes: 0n, stored_bytes: 0n, objects: 0n },
      ])
      .mockResolvedValueOnce([
        { stored_bytes: 0n, present: 0n, pruned: 0n, unstored: 0n },
      ]);

    await service.collect();

    expect(gaugeValue(bytes, { tier: TIER_CITED, location: 'postgres' })).toBe(
      0,
    );
    // Never a divide-by-zero: an empty tier compresses by definition 1x.
    expect(gaugeValue(ratio, { tier: TIER_CITED, method: 'toast' })).toBe(1);
  });

  it('leaves values untouched when a tier fails to measure', async () => {
    db.$queryRaw = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce([bulkRow]);

    await service.collect();

    // Publishing zero would report an empty store, indistinguishable from a
    // healthy store holding nothing — the exact failure shape this issue
    // exists to prevent. The stale freshness gauge is the signal instead.
    expect(
      gaugeValue(bytes, { tier: TIER_CITED, location: 'postgres' }),
    ).toBeUndefined();
    expect(gaugeValue(freshness, { tier: TIER_CITED })).toBeUndefined();
  });

  it('still measures the other tier when one fails', async () => {
    db.$queryRaw = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce([bulkRow]);

    await service.collect();

    expect(
      gaugeValue(bytes, { tier: TIER_BULK, location: 'object-storage' }),
    ).toBe(1073741824);
  });

  it('measures once at startup rather than waiting for the schedule', async () => {
    await service.onModuleInit();

    // A freshly deployed service reporting nothing looks identical to one
    // whose store is empty.
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
