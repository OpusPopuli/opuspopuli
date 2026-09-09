import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  QueueService,
  REGION_SYNC_QUEUE,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import type { RegionSyncJobData } from '@opuspopuli/queue-provider';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { RegionDomainService } from 'src/apps/region/src/domains/region.service';
import { format } from 'date-fns';
import { staggeredCron } from './cadence.utils';

const DAILY_CRON = '0 2 * * *';

@Injectable()
export class RegionSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegionSyncScheduler.name, {
    timestamp: true,
  });

  constructor(
    private readonly queueService: QueueService,
    private readonly pipelineJobService: PipelineJobService,
    private readonly regionService: RegionDomainService,
  ) {}

  async onApplicationBootstrap() {
    const cronEnabled = process.env.REGION_SYNC_CRON_ENABLED !== 'false';
    const runOnStartup = process.env.REGION_SYNC_RUN_ON_STARTUP === 'true';

    if (cronEnabled) {
      await this.registerSchedulers();
    } else {
      this.logger.log(
        'REGION_SYNC_CRON_ENABLED=false — skipping scheduler registration',
      );
    }

    if (runOnStartup) {
      await this.enqueueStartupJob();
    }
  }

  private async registerSchedulers(): Promise<void> {
    const configs = await this.regionService.getPluginDataSourceConfigs();

    // Fall back to one blanket scheduler ONLY when there is nothing to
    // schedule per-source. This used to key off "no source declares a
    // cadence", which was the #1184 trap: one region declaring cadences
    // suppressed the fallback for every other region, and a region whose
    // sources declared none then registered nothing at all. Now that a
    // missing cadence gets a default below, the per-source path always
    // covers a config that HAS sources, and this is only for the empty case
    // (no plugins enabled, or none carrying data sources).
    const totalSources = configs.reduce(
      (count, { sources }) => count + sources.length,
      0,
    );

    if (totalSources === 0) {
      await this.queueService.upsertScheduler(
        REGION_SYNC_QUEUE,
        'daily-cron',
        DAILY_CRON,
        {
          triggerSource: TRIGGER_SOURCE.CRON,
        } satisfies Partial<RegionSyncJobData>,
      );
      this.logger.log(
        `Registered daily-cron scheduler on ${REGION_SYNC_QUEUE} (${DAILY_CRON})`,
      );
      return;
    }

    const registeredKeys = new Set<string>();

    // Each source can register two independent schedulers — the daily/regular
    // syncCadence and the bills-only weekly statusScanCadence. Each upsert
    // is isolated in its own try/catch via `registerSourceScheduler` so a
    // failure on one does not prevent the other from registering.
    for (const { regionId, sources } of configs) {
      const before = registeredKeys.size;

      for (const source of sources) {
        // A source with no `syncCadence` used to be SKIPPED, which meant a
        // plugin whose config declared none registered nothing at all — and
        // the `hasCadences` fallback above could not help, because one other
        // region declaring cadences suppresses it. Sonoma shipped enabled
        // with four sources and zero cadences and therefore never synced,
        // silently, until someone ran the mutation by hand (#1184).
        //
        // A configured data source that never runs is not a choice anyone
        // makes deliberately, so default it. `staggeredCron` spreads the
        // load by source, so defaulting many sources to one base cron does
        // not stampede.
        // `||` not `??` — deliberately. `syncCadence` is an optional string
        // from JSON config, so `""` is reachable, and `??` would let it
        // through to staggeredCron() as an invalid pattern. The old code's
        // `if (source.syncCadence)` guard treated `""` as absent; keep that.
        const cadence = source.syncCadence || DAILY_CRON;

        if (!source.syncCadence) {
          this.logger.warn(
            `${regionId}/${source.dataType} declares no syncCadence — ` +
              `defaulting to ${DAILY_CRON}. Set one in the region config to ` +
              `choose its own schedule.`,
          );
        }

        await this.registerSourceScheduler(
          `${regionId}-${source.dataType}-cron`,
          staggeredCron(cadence, `${regionId}-${source.dataType}`),
          {
            triggerSource: TRIGGER_SOURCE.CRON,
            regionId,
            dataTypes: [source.dataType as string],
          },
          registeredKeys,
        );

        // Weekly bills status-scan backstop (#689) — bills only.
        if (source.statusScanCadence && source.dataType === 'bills') {
          await this.registerSourceScheduler(
            `${regionId}-bills-status-scan-cron`,
            staggeredCron(
              source.statusScanCadence,
              `${regionId}-bills-status-scan`,
            ),
            {
              triggerSource: TRIGGER_SOURCE.CRON,
              regionId,
              dataTypes: ['bills'],
              forceStatusRecheck: true,
            },
            registeredKeys,
          );
        }
      }

      // Defensive: after the default above this should be unreachable for a
      // plugin that has any sources. If it ever fires, the guard has
      // regressed and that region is silently dark again — which is the
      // whole failure mode of #1184, and it took a production incident to
      // notice because nothing said so.
      if (sources.length > 0 && registeredKeys.size === before) {
        this.logger.warn(
          `${regionId} has ${sources.length} data source(s) but registered ` +
            `NO schedulers — it will never sync on its own.`,
        );
      }
    }

    await this.removeStaleSchedulers(registeredKeys);
  }

  /**
   * Upsert a single scheduler with try/catch and structured logging.
   * Adds `key` to `registeredKeys` on success so `removeStaleSchedulers`
   * preserves it. Catches and warns on failure — caller continues.
   */
  private async registerSourceScheduler(
    key: string,
    cron: string,
    jobData: Partial<RegionSyncJobData>,
    registeredKeys: Set<string>,
  ): Promise<void> {
    try {
      await this.queueService.upsertScheduler(
        REGION_SYNC_QUEUE,
        key,
        cron,
        jobData,
      );
      registeredKeys.add(key);
      this.logger.log(`Registered scheduler ${key} (${cron})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register scheduler ${key}: ${(err as Error).message}`,
      );
    }
  }

  private async removeStaleSchedulers(activeKeys: Set<string>): Promise<void> {
    const existing = await this.queueService.listSchedulers(REGION_SYNC_QUEUE);

    for (const scheduler of existing) {
      if (!activeKeys.has(scheduler.id)) {
        await this.queueService.removeScheduler(
          REGION_SYNC_QUEUE,
          scheduler.id,
        );
        this.logger.log(`Removed stale scheduler ${scheduler.id}`);
      }
    }
  }

  private async enqueueStartupJob() {
    const yyyymmdd = format(new Date(), 'yyyyMMdd');
    const jobId = `startup-${yyyymmdd}`;

    const row = await this.pipelineJobService.create({
      bullmqJobId: jobId,
      triggerSource: TRIGGER_SOURCE.STARTUP,
    });

    const data: RegionSyncJobData = {
      pipelineJobId: row.id,
      triggerSource: TRIGGER_SOURCE.STARTUP,
    };

    await this.queueService.enqueue(REGION_SYNC_QUEUE, data, { jobId });
    this.logger.log(`Enqueued startup region-sync job (jobId=${jobId})`);
  }
}
