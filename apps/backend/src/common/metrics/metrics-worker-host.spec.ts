import { Test } from '@nestjs/testing';
import {
  METRICS_OBSERVER,
  PdfParseMetric,
  QueueMetric,
  type MetricsObserver,
} from '@opuspopuli/common';
import { register } from 'prom-client';
import { MetricsModule } from './metrics.module';

/**
 * Phase B's metrics through the real module: the job and parse series are
 * declared and reachable through the observer, and a worker's series carry
 * its `WORKER_HOST`. Asserts the rendered scrape, as the M1 spec does.
 */
describe('metrics scrape — Phase B series and worker_host', () => {
  let observer: MetricsObserver;

  beforeAll(async () => {
    register.clear();
    process.env.WORKER_HOST = 'node-a';
    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule.forRoot({ serviceName: 'region-worker' })],
    }).compile();
    await moduleRef.createNestApplication().init();
    observer = moduleRef.get<MetricsObserver>(METRICS_OBSERVER);
  });

  afterAll(() => {
    delete process.env.WORKER_HOST;
    register.setDefaultLabels({});
    register.clear();
  });

  it('renders job attempts, job durations and parse sources, labelled with the host', async () => {
    observer.increment(QueueMetric.JobAttemptsTotal, 1, {
      queue: 'pdf-parse',
      trigger: 'unknown',
      outcome: 'success',
    });
    observer.observe(QueueMetric.JobDurationSeconds, 2.5, {
      queue: 'pdf-parse',
      trigger: 'unknown',
    });
    observer.increment(PdfParseMetric.Total, 1, {
      source: 'lane',
      complete: 'true',
    });

    const scrape = await register.metrics();
    expect(scrape).toMatch(
      /bullmq_job_attempts_total\{[^}]*queue="pdf-parse"[^}]*outcome="success"[^}]*worker_host="node-a"[^}]*\} 1/,
    );
    expect(scrape).toMatch(
      /bullmq_job_duration_seconds_count\{[^}]*queue="pdf-parse"[^}]*\} 1/,
    );
    expect(scrape).toMatch(
      /pdf_parse_total\{[^}]*source="lane"[^}]*complete="true"[^}]*\} 1/,
    );
  });
});
