import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RegionDomainService } from './region.service';

/**
 * Region Scheduler (legacy cron path)
 *
 * Retained for rollout safety behind REGION_SYNC_CRON_VIA_QUEUE=false.
 * When REGION_SYNC_CRON_VIA_QUEUE=true the worker's RegionSyncScheduler
 * owns the daily repeatable job and this class becomes inert.
 * Cleanup PR: delete this file and remove from RegionDomainModule.
 */
@Injectable()
export class RegionScheduler {
  private readonly logger = new Logger(RegionScheduler.name, {
    timestamp: true,
  });
  private readonly syncEnabled: boolean;
  private readonly syncCronViaQueue: boolean;
  private readonly syncRunOnStartup: boolean;

  constructor(
    private readonly regionService: RegionDomainService,
    private readonly configService: ConfigService,
  ) {
    this.syncEnabled = this.configService.get('region.syncEnabled') !== false;
    this.syncCronViaQueue =
      this.configService.get<boolean>('region.syncCronViaQueue') === true;
    this.syncRunOnStartup =
      this.configService.get<boolean>('region.syncRunOnStartup') === true;
  }

  async onModuleInit() {
    if (!this.syncRunOnStartup) {
      return;
    }
    this.logger.log(
      'Running initial data sync on startup (REGION_SYNC_RUN_ON_STARTUP=true)',
    );
    try {
      await this.syncData();
    } catch (error) {
      this.logger.error('Startup sync failed:', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleScheduledSync() {
    if (!this.syncEnabled || this.syncCronViaQueue) {
      return;
    }
    this.logger.log('Running scheduled data sync');
    await this.syncData();
  }

  private async syncData() {
    try {
      const results = await this.regionService.syncAll();
      const summary = results
        .map(
          (r) =>
            `${r.dataType}: ${r.itemsProcessed} processed (${r.itemsCreated} new, ${r.itemsUpdated} updated)`,
        )
        .join(', ');
      this.logger.log(`Sync complete: ${summary}`);
      const errors = results.flatMap((r) => r.errors);
      if (errors.length > 0) {
        this.logger.warn(
          `Sync had ${errors.length} errors: ${errors.join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error('Scheduled sync failed:', error);
    }
  }
}
