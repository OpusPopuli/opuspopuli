import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { DbService } from '@opuspopuli/relationaldb-provider';

/** Tier 1: cited sources, immutable, held in Postgres. */
export const TIER_CITED = 'cited';
/** Tier 2: bulk exports, pruned to latest + monthly, held in object storage. */
export const TIER_BULK = 'bulk';

/**
 * Measures the source store and publishes it per tier (#1278).
 *
 * Emitted from the region service because it is always-on and already scraped.
 * The issue is explicit about why that matters: the natural home for the
 * backup-freshness gauge was an overlay that `op-deploy` excludes by design —
 * the same mechanism that let backups die unnoticed for 49 days (#1217, #1270).
 * A watchdog that can be left out of a deploy is not a watchdog.
 *
 * Reports the two tiers separately. Their retention policies differ — cited
 * sources are immutable forever, bulk snapshots are pruned to latest plus one
 * per calendar month — so an aggregate would hide which one is growing, which
 * is the only question these gauges exist to answer.
 */
@Injectable()
export class SourceStoreMetricsService implements OnModuleInit {
  private readonly logger = new Logger(SourceStoreMetricsService.name);

  constructor(
    private readonly db: DbService,
    @InjectMetric('source_store_bytes')
    private readonly bytes: Gauge<string>,
    @InjectMetric('source_store_objects')
    private readonly objects: Gauge<string>,
    @InjectMetric('source_store_compression_ratio')
    private readonly compressionRatio: Gauge<string>,
    @InjectMetric('source_store_last_measured_timestamp_seconds')
    private readonly lastMeasured: Gauge<string>,
  ) {}

  /**
   * Publish once at startup so a freshly deployed service reports real numbers
   * immediately rather than nothing until the first scheduled run.
   */
  async onModuleInit(): Promise<void> {
    await this.collect();
  }

  /**
   * Re-measure on a schedule rather than on each Prometheus scrape.
   *
   * The measurement is an aggregate over the store tables, and scrape interval
   * is not something this service controls — binding DB load to it would let a
   * monitoring config change turn into database load. Five minutes is far
   * finer than the growth these gauges track, which is measured in GB per
   * year.
   */
  @Cron('*/5 * * * *')
  async collectScheduled(): Promise<void> {
    await this.collect();
  }

  /**
   * Measure both tiers and publish the result.
   *
   * A tier that fails to measure is left at its previous value rather than
   * published as zero. A false zero reads as "the store is empty", which is
   * indistinguishable from "nothing is being stored" — the exact shape of
   * failure this issue exists to prevent. The freshness gauge is what makes
   * the staleness visible instead.
   */
  async collect(): Promise<void> {
    await this.measureCited();
    await this.measureBulk();
  }

  /**
   * Tier 1 — Postgres.
   *
   * `pg_column_size` reports what the row actually occupies after TOAST
   * compression, while `octet_length` reports the artifact's real size. The
   * ratio between them is the compression this store is *already* getting for
   * free: measured at 3.15x on real civic HTML, which is why app-level
   * compression was dropped from this issue's scope rather than added.
   */
  private async measureCited(): Promise<void> {
    try {
      const [row] = await this.db.$queryRaw<
        Array<{
          logical_bytes: bigint | null;
          stored_bytes: bigint | null;
          objects: bigint;
        }>
      >`
        SELECT COALESCE(SUM(octet_length(content)), 0)::bigint   AS logical_bytes,
               COALESCE(SUM(pg_column_size(content)), 0)::bigint AS stored_bytes,
               COUNT(*)::bigint                                  AS objects
        FROM source_versions
      `;

      const logical = Number(row.logical_bytes ?? 0n);
      const stored = Number(row.stored_bytes ?? 0n);

      this.bytes.set({ tier: TIER_CITED, location: 'postgres' }, stored);
      this.bytes.set({ tier: TIER_CITED, location: 'logical' }, logical);
      this.objects.set(
        { tier: TIER_CITED, state: 'present' },
        Number(row.objects),
      );
      this.compressionRatio.set(
        { tier: TIER_CITED, method: 'toast' },
        stored > 0 ? logical / stored : 1,
      );
      this.markMeasured(TIER_CITED);
    } catch (error) {
      this.reportFailure(TIER_CITED, error);
    }
  }

  /**
   * Tier 2 — object storage.
   *
   * Byte totals come from the recorded sizes rather than from the store,
   * because listing a bucket per scrape is a network round trip and the sizes
   * are already known at archive time. Pruned snapshots are counted separately:
   * their rows survive on purpose, so counting them as present would overstate
   * what is actually held.
   */
  private async measureBulk(): Promise<void> {
    try {
      const [row] = await this.db.$queryRaw<
        Array<{
          stored_bytes: bigint | null;
          present: bigint;
          pruned: bigint;
          unstored: bigint;
        }>
      >`
        SELECT COALESCE(SUM(byte_size) FILTER (WHERE storage_key IS NOT NULL), 0)::bigint AS stored_bytes,
               COUNT(*) FILTER (WHERE storage_key IS NOT NULL)::bigint                    AS present,
               COUNT(*) FILTER (WHERE pruned_at IS NOT NULL)::bigint                      AS pruned,
               COUNT(*) FILTER (WHERE pruned_at IS NULL AND storage_key IS NULL)::bigint  AS unstored
        FROM bulk_snapshots
      `;

      this.bytes.set(
        { tier: TIER_BULK, location: 'object-storage' },
        Number(row.stored_bytes ?? 0n),
      );
      this.objects.set(
        { tier: TIER_BULK, state: 'present' },
        Number(row.present),
      );
      this.objects.set(
        { tier: TIER_BULK, state: 'pruned' },
        Number(row.pruned),
      );
      // Recorded but never uploaded — on a Supabase-backed deployment the
      // 50 MB per-file limit makes this the expected outcome for a ~1 GB
      // export, and it must be visible rather than looking like an empty tier.
      this.objects.set(
        { tier: TIER_BULK, state: 'unstored' },
        Number(row.unstored),
      );
      // Payloads are ZIPs, already deflate-compressed; measured at 1.00x under
      // further compression. Reported so the graph says so rather than leaving
      // the question open.
      this.compressionRatio.set({ tier: TIER_BULK, method: 'none' }, 1);
      this.markMeasured(TIER_BULK);
    } catch (error) {
      this.reportFailure(TIER_BULK, error);
    }
  }

  private markMeasured(tier: string): void {
    this.lastMeasured.set({ tier }, Math.floor(Date.now() / 1000));
  }

  private reportFailure(tier: string, error: unknown): void {
    // Deliberately does not touch the value gauges. Publishing zero here would
    // report an empty store, which looks identical to a healthy store that is
    // holding nothing — and leaves the freshness gauge as the only signal that
    // anything is wrong.
    this.logger.warn(
      `Failed to measure ${tier} source-store tier: ${(error as Error).message}`,
    );
  }
}
