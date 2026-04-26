/**
 * One-off: run LegislativeCommitteeDescriptionGeneratorService against the
 * `LegislativeCommittee` rows already in the DB. Useful for:
 *
 * - Backfilling descriptions on first deploy without waiting for the next
 *   sync cycle (the post-sync hook will eventually do this, but a manual
 *   pass is faster when you've just shipped the feature).
 * - Re-generating after a tweak to the
 *   `document-analysis-legislative-committee-description` prompt in the
 *   prompt-service — drop existing descriptions first if you want to
 *   force regeneration:
 *     UPDATE legislative_committees SET description = NULL;
 *
 * Usage (after `pnpm --filter backend build:region`):
 *   node apps/backend/dist/src/apps/region/apps/region/src/scripts/run-legislative-committee-descriptions.js
 *
 * Optional cap: pass an integer to limit how many committees are
 * processed in this run (env LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES
 * also works):
 *   node …/run-legislative-committee-descriptions.js 5
 *
 * Idempotent: only committees with `description IS NULL` are processed.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { LegislativeCommitteeDescriptionGeneratorService } from '../domains/legislative-committee-description-generator.service';

async function main(): Promise<void> {
  const logger = new Logger('run-legislative-committee-descriptions');
  const cap = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(LegislativeCommitteeDescriptionGeneratorService, {
      strict: false,
    });
    logger.log(
      `Starting legislative committee description pass${cap ? ` (cap=${cap})` : ''}…`,
    );
    await service.generateMissingDescriptions(cap);
    logger.log('Done.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Description run failed:', err);
  process.exit(1);
});
