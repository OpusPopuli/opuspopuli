import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  Inject,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
  register,
  type Gauge,
  type Metric,
  type MetricValueWithName,
} from 'prom-client';
import {
  DbService,
  type DbLaneHistogram,
  type DbLaneHistograms,
} from '@opuspopuli/relationaldb-provider';
import type { MetricsModuleOptions } from './metrics.module';

const LANE_HISTOGRAMS: Array<{
  name: string;
  help: string;
  pick: keyof DbLaneHistograms;
}> = [
  {
    name: 'db_lane_wait_seconds',
    help: 'Time a query waited for a pool connection — the DB lane queue',
    pick: 'wait',
  },
  {
    name: 'db_lane_query_seconds',
    help: 'Time a query spent in the database',
    pick: 'query',
  },
  {
    name: 'db_lane_total_seconds',
    help: 'Time a query took as the client saw it, wait included',
    pick: 'total',
  },
];

/** What prom-client's registry reads from a metric: `get()` and `reset()`. */
interface LaneCollector {
  name: string;
  help: string;
  get(): Promise<{
    name: string;
    help: string;
    type: 'histogram';
    values: MetricValueWithName<string>[];
    aggregator: 'sum';
  }>;
  reset(): void;
}

/** One histogram's series in prom-client's `get()` shape. */
export function histogramValues(
  name: string,
  h: DbLaneHistogram,
): MetricValueWithName<string>[] {
  return [
    ...h.buckets.map(([le, count]) => ({
      metricName: `${name}_bucket`,
      labels: { le },
      value: count,
    })),
    { metricName: `${name}_bucket`, labels: { le: '+Inf' }, value: h.count },
    { metricName: `${name}_sum`, labels: {}, value: h.sum },
    { metricName: `${name}_count`, labels: {}, value: h.count },
  ];
}

/**
 * The DB lane's histograms (`docs/plans/db-lane.md`), republished from
 * Prisma's own on every scrape rather than re-observed — Prisma already
 * times every query, cumulatively since the client started, which is exactly
 * a Prometheus histogram's contract. Also publishes the pool's size, the
 * lane's bound.
 *
 * Registered only in a process that has a database (`DbService` is optional:
 * the gateway has none).
 */
@Injectable()
export class DbLaneCollector implements OnModuleInit, OnModuleDestroy {
  private readonly registered: string[] = [];

  constructor(
    @Inject('METRICS_OPTIONS') private readonly options: MetricsModuleOptions,
    @InjectMetric('db_lane_pool_size') private readonly poolSize: Gauge<string>,
    @Optional() private readonly db?: DbService,
  ) {}

  onModuleInit(): void {
    if (!this.db) return;
    const pool = DbService.poolSize();
    this.poolSize.set(
      {
        service: this.options.serviceName,
        estimated: String(pool.estimated),
      },
      pool.size,
    );
    for (const { name, help, pick } of LANE_HISTOGRAMS) {
      if (register.getSingleMetric(name)) continue;
      register.registerMetric(this.collector(name, help, pick));
      this.registered.push(name);
    }
  }

  /**
   * Prisma's histograms, read once per scrape: the three collectors run in
   * the same scrape within a second of each other, and each would otherwise
   * make its own `$metrics.json()` call into the engine.
   */
  private lane(): Promise<DbLaneHistograms | null> {
    const now = Date.now();
    if (!this.cached || now - this.cachedAt > 1_000) {
      this.cached = this.db!.getLaneHistograms();
      this.cachedAt = now;
    }
    return this.cached;
  }

  private cached?: Promise<DbLaneHistograms | null>;
  private cachedAt = 0;

  /**
   * A collector prom-client renders as a histogram. Its registry formats
   * whatever `get()` returns; the class `Histogram` would re-observe, and
   * these are already Prisma's cumulative counts.
   */
  private collector(
    name: string,
    help: string,
    pick: keyof DbLaneHistograms,
  ): Metric<string> {
    const collector: LaneCollector = {
      name,
      help,
      get: async () => {
        const lane = await this.lane();
        return {
          name,
          help,
          type: 'histogram',
          values: lane ? histogramValues(name, lane[pick]) : [],
          aggregator: 'sum',
        };
      },
      reset: () => undefined,
    };
    // The one cast: prom-client's published `Metric` types its `type` as a
    // numeric enum and demands a `collect` its registry never reads, while
    // the registry itself formats the string `type` above (15.1.3).
    return collector as unknown as Metric<string>;
  }

  onModuleDestroy(): void {
    for (const name of this.registered.splice(0)) {
      register.removeSingleMetric(name);
    }
  }
}
