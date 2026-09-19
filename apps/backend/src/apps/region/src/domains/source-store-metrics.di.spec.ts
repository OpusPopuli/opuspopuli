import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MetricsModule } from 'src/common/metrics';
import { SourceStoreMetricsService } from './source-store-metrics.service';

/**
 * Boots the collector through Nest rather than constructing it.
 *
 * The unit spec builds this service with `new`, which bypasses dependency
 * injection entirely — so it passed while the region service could not start
 * at all. `MetricsModule.forRoot` returns `global: true` but exported only
 * `MetricsService`, and a global module shares nothing it does not export, so
 * every `@InjectMetric` token here was unresolvable. CI caught it as two dead
 * E2E shards and a container that never became healthy (#1278).
 *
 * This is the same class of failure as the SOURCE_ARCHIVE scope bug in #1276:
 * a provider registered where the thing that injects it cannot see it. A test
 * that constructs the class itself can never catch it.
 */
const DB_STUB = {
  $queryRaw: jest
    .fn()
    .mockResolvedValue([{ logical_bytes: 0n, stored_bytes: 0n, objects: 0n }]),
};

@Module({
  imports: [MetricsModule.forRoot({ serviceName: 'region-service-test' })],
  providers: [
    SourceStoreMetricsService,
    { provide: DbService, useValue: DB_STUB },
  ],
})
class BootProbeModule {}

describe('SourceStoreMetricsService DI', () => {
  it('resolves every injected metric when booted through Nest', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BootProbeModule],
    }).compile();

    // Constructing it is the assertion: if any @InjectMetric token were
    // unresolvable, Nest would throw here — which is exactly what happened to
    // region-service at startup.
    const service = moduleRef.get(SourceStoreMetricsService, { strict: false });
    expect(service).toBeInstanceOf(SourceStoreMetricsService);

    await moduleRef.close();
  });
});
