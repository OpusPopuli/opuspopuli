/**
 * One-off: trigger representatives-only sync from the local declarative
 * region plugin. Useful when you need clean rep data without waiting
 * for the 2 AM scheduled `syncAll()` and without paying the cost of
 * the full multi-hour CalAccess + propositions + meetings cycle.
 *
 * Usage (assumes the region container is running and dist is built):
 *   docker compose -f docker-compose-uat.yml exec region \
 *     node dist/src/apps/region/apps/region/src/scripts/run-rep-sync.js
 *
 * Idempotent: representatives are upserted by externalId, so re-running
 * is safe — repeated runs just refresh existing rows. Sync time is
 * dominated by the LLM-driven detail-page enrichment, ~5 minutes when
 * manifests are cached, ~12 minutes on a fresh manifest regeneration.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { RegionDomainService } from '../domains/region.service';
import { DataType } from '@opuspopuli/region-provider';

async function main(): Promise<void> {
  const logger = new Logger('run-rep-sync');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const regionService = app.get(RegionDomainService, { strict: false });
    logger.log('Starting representatives-only sync…');
    const result = await regionService.syncDataType(DataType.REPRESENTATIVES);
    logger.log(
      `Done. processed=${result.itemsProcessed} created=${result.itemsCreated} ` +
        `updated=${result.itemsUpdated} errors=${result.errors.length}`,
    );
    if (result.errors.length > 0) {
      logger.warn(`Errors: ${result.errors.join(' | ')}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Rep sync run failed:', err);
  process.exit(1);
});
