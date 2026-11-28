import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { BoundaryLoaderService } from './domains/boundary-loader.service';

/**
 * Runs the boundary load once at boot — in the region service only.
 *
 * The loader lives in RegionDomainModule, which region-worker and
 * structural-analysis-worker also import. While the boot hook lived on the
 * loader, all three ran it on every start, and on the first boot after a
 * change they fetched the same display layers and wrote the same rows at
 * once (#1475). Registered only in the region app's module, one process
 * loads at boot; the workers still run loads when a queued `boundaries`
 * job asks for one.
 *
 * Never awaited — health checks shouldn't block on a 1–5 minute boundary
 * fetch — and never throws: the loader's own per-row and per-step handling
 * make it safe to call unconditionally. Disable with
 * FORCE_RELOAD_BOUNDARIES=skip-boot (useful where the boot fetch would hit
 * real TIGER/geoportal URLs, as in integration tests); the admin
 * refreshBoundaries mutation still works.
 */
@Injectable()
export class BoundaryBootService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BoundaryBootService.name);

  constructor(private readonly loader: BoundaryLoaderService) {}

  onApplicationBootstrap(): void {
    if (process.env.FORCE_RELOAD_BOUNDARIES === 'skip-boot') {
      this.logger.log(
        'BoundaryLoader: FORCE_RELOAD_BOUNDARIES=skip-boot — bypassing boot-time load.',
      );
      return;
    }
    this.loader.loadAll().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `BoundaryLoader: boot-time load threw (this should never happen — loadAll catches per-row errors internally): ${message}`,
      );
    });
  }
}
