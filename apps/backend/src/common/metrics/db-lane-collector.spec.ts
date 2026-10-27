import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { register } from 'prom-client';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MetricsModule } from './metrics.module';

/**
 * The DB lane's histograms through the real module and the rendered scrape —
 * a custom collector is exactly where a wrong shape (per-bucket counts, ms,
 * no +Inf) would pass a unit test and produce an unparseable or misleading
 * series.
 */
describe('DbLaneCollector (docs/plans/db-lane.md)', () => {
  const histogram = (sum: number) => ({
    buckets: [
      [0.001, 2],
      [0.005, 3],
    ] as Array<[number, number]>,
    sum,
    count: 3,
  });

  const start = async (db: unknown) => {
    register.clear();
    // Global, as RelationalDbModule is: that is how MetricsModule's scope
    // sees DbService in the apps.
    @Global()
    @Module({
      providers: [{ provide: DbService, useValue: db }],
      exports: [DbService],
    })
    class FakeDbModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...(db ? [FakeDbModule] : []),
        MetricsModule.forRoot({ serviceName: 'region-worker' }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  };

  afterEach(() => register.clear());

  it('renders wait, query and total as cumulative histograms with +Inf', async () => {
    const db = {
      getLaneHistograms: jest.fn().mockResolvedValue({
        wait: histogram(0.0001),
        query: histogram(0.002),
        total: histogram(0.003),
      }),
      getPoolMetrics: jest.fn().mockResolvedValue(null),
    };
    const app = await start(db);

    const scrape = await register.metrics();
    expect(scrape).toContain('# TYPE db_lane_wait_seconds histogram');
    expect(scrape).toMatch(
      /db_lane_wait_seconds_bucket\{[^}]*le="0.001"[^}]*\} 2/,
    );
    expect(scrape).toMatch(
      /db_lane_query_seconds_bucket\{[^}]*le="\+Inf"[^}]*\} 3/,
    );
    expect(scrape).toMatch(/db_lane_total_seconds_sum(\{[^}]*\})? 0.003/);
    expect(scrape).toMatch(
      /db_lane_pool_size\{[^}]*service="region-worker"[^}]*estimated="(true|false)"[^}]*\} \d+/,
    );
    // Three histograms, one read of Prisma's metrics.
    expect(db.getLaneHistograms).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('registers nothing without a database (the gateway)', async () => {
    const app = await start(undefined);
    expect(await register.metrics()).not.toContain('db_lane_wait_seconds');
    await app.close();
  });
});
