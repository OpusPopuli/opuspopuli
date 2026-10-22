import { Test } from '@nestjs/testing';
import {
  METRICS_OBSERVER,
  PipelineMetric,
  PipelineStage,
  type MetricsObserver,
} from '@opuspopuli/common';
import { register } from 'prom-client';
import { MetricsModule } from './metrics.module';

/**
 * The exemplar chain, end to end through the real module (M1).
 *
 * Three independent switches have to agree or a trace link silently
 * disappears: the scrape must be served as OpenMetrics (prom-client renders
 * exemplars in no other format), the histogram must be declared with
 * `enableExemplars`, and the observer must pick the object overload. Nothing
 * owns all three, and every failure mode is silent — the panel still draws,
 * with nothing behind the dots.
 *
 * So this asserts the rendered document rather than the calls that produced
 * it. The same shapes were verified to parse on prom/prometheus v2.51.0,
 * exemplar stored, before the content type was switched.
 */
describe('metrics scrape (M1)', () => {
  let observer: MetricsObserver;
  let scrape: () => Promise<string>;

  beforeAll(async () => {
    // prom-client's default registry is module-global. Jest gives each test
    // FILE a fresh module registry, but clear it anyway so this cannot
    // collide with whatever ran before it in the same worker.
    register.clear();

    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule.forRoot({ serviceName: 'test-service' })],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    observer = moduleRef.get<MetricsObserver>(METRICS_OBSERVER);
    scrape = () => register.metrics();
  });

  afterAll(() => register.clear());

  it('serves OpenMetrics, which exemplars require', () => {
    expect(register.contentType).toBe(
      'application/openmetrics-text; version=1.0.0; charset=utf-8',
    );
  });

  it('renders the trace id as an exemplar on the bucket it landed in', async () => {
    const traceId = 'abcdef0123456789abcdef0123456789';

    observer.observe(
      PipelineMetric.StageDurationSeconds,
      42.5,
      { stage: PipelineStage.Llm, data_type: 'bills', lane: 'ingestion' },
      { trace_id: traceId },
    );

    const body = await scrape();
    const bucket = body
      .split('\n')
      .find(
        (line) =>
          line.startsWith('pipeline_stage_duration_seconds_bucket') &&
          line.includes('le="60"') &&
          line.includes('stage="llm"'),
      );

    expect(bucket).toBeDefined();
    // `# {trace_id="…"} value timestamp` — the OpenMetrics exemplar form.
    expect(bucket).toContain(`# {trace_id="${traceId}"}`);
  });

  it('renders no exemplar when none was attached', async () => {
    observer.observe(PipelineMetric.StageDurationSeconds, 0.02, {
      stage: PipelineStage.DbWrite,
    });

    const body = await scrape();
    const bucket = body
      .split('\n')
      .find(
        (line) =>
          line.startsWith('pipeline_stage_duration_seconds_bucket') &&
          line.includes('le="0.05"') &&
          line.includes('stage="db_write"'),
      );

    expect(bucket).toBeDefined();
    expect(bucket).not.toContain('#');
  });

  it('terminates the document with # EOF, as the format demands', async () => {
    expect(await scrape()).toMatch(/# EOF\n$/);
  });

  it('does not double-suffix a counter already named _total', async () => {
    // OpenMetrics appends `_total` to counter SAMPLES and names the FAMILY
    // without the reserved suffix, so `# TYPE` loses it while the series
    // keeps it. Both halves matter: a double suffix would silently rename
    // every series existing dashboards and alert rules query. Verified
    // against prom/prometheus v2.51.0 before the format was switched — it
    // read the series back unchanged.
    observer.increment(PipelineMetric.ItemsTotal, 1, {
      data_type: 'civics',
      outcome: 'updated',
    });

    const body = await scrape();

    expect(body).not.toContain('_total_total');
    expect(body).toContain('# TYPE pipeline_items counter');
    expect(body).toMatch(/^pipeline_items_total\{/m);
  });

  it('keeps a gauge whose name ends in _total a gauge', async () => {
    // `claims_total`, `documents_total` and `documents_embedded_total` are
    // gauges with a counter-shaped name. OpenMetrics reserves that suffix for
    // counters, and if Prometheus rejected the document we would lose EVERY
    // metric, not just these — a monitoring outage (#1343), not a gap.
    const body = await scrape();

    for (const name of [
      'claims_total',
      'documents_total',
      'documents_embedded_total',
    ]) {
      expect(body).toContain(`# TYPE ${name} gauge`);
    }
  });

  it('counts pipeline items and aborts through the same observer', async () => {
    observer.increment(PipelineMetric.ItemsTotal, 1, {
      data_type: 'bills',
      phase: 'extract_and_upsert',
      outcome: 'created',
    });
    observer.increment(PipelineMetric.PhaseAbortedTotal, 1, {
      data_type: 'bills',
      phase: 'extract_and_upsert',
    });

    const body = await scrape();

    expect(body).toMatch(
      /pipeline_items_total\{[^}]*outcome="created"[^}]*\} 1/,
    );
    expect(body).toMatch(/pipeline_phase_aborted_total\{[^}]*\} 1/);
  });
});
