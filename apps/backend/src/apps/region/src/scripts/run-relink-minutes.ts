/**
 * One-off: re-run the legislative-action linker over every active
 * Minutes row in the database. Useful after the linker is improved —
 * regenerates LegislativeAction rows from the already-stored
 * `rawText` without re-fetching the source PDFs.
 *
 * Idempotent (existing actions for each Minutes are deleted before
 * re-insert), so running it twice in a row is a no-op on the second
 * pass.
 *
 * Usage (assumes the region container is running):
 *   docker compose -f docker-compose-uat.yml exec region \
 *     node dist/src/apps/region/apps/region/src/scripts/run-relink-minutes.js
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { LegislativeActionLinkerService } from '../domains/legislative-action-linker.service';

async function main(): Promise<void> {
  const logger = new Logger('run-relink-minutes');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const linker = app.get(LegislativeActionLinkerService, { strict: false });
    logger.log('Re-linking all active Minutes…');
    const result = await linker.relinkAll();
    logger.log(
      `Done. minutesProcessed=${result.minutesProcessed} actionsCreated=${result.actionsCreated}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Relink failed:', err);
  process.exit(1);
});
