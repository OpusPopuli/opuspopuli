/**
 * One-off: regenerate AI-driven activity summaries for every
 * representative and legislative committee with at least one
 * LegislativeAction in the configured window.
 *
 * Mirrors the existing `run-rep-sync.ts` shape.
 *
 * Usage (assumes the region container is running and dist is built):
 *   docker compose -f docker-compose-uat.yml exec region \
 *     node dist/src/apps/region/apps/region/src/scripts/run-generate-activity-summaries.js
 *
 * Optional: pass an override window in days as the first arg.
 *   ... run-generate-activity-summaries.js 30
 *
 * Idempotent — re-running is safe; entities whose underlying actions
 * haven't changed will produce roughly the same summary (modulo LLM
 * non-determinism). The persist step always overwrites.
 *
 * Issue #665.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { EntityActivitySummaryGeneratorService } from '../domains/entity-activity-summary-generator.service';

async function main(): Promise<void> {
  const logger = new Logger('run-generate-activity-summaries');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const generator = app.get(EntityActivitySummaryGeneratorService, {
      strict: false,
    });
    const overrideArg = process.argv[2];
    const overrideWindow = overrideArg
      ? Number.parseInt(overrideArg, 10)
      : undefined;
    if (
      overrideArg &&
      (!Number.isFinite(overrideWindow) || (overrideWindow ?? 0) <= 0)
    ) {
      logger.warn(`Invalid window arg "${overrideArg}", using default`);
    }
    logger.log('Generating activity summaries…');
    const result = await generator.generateAll(
      Number.isFinite(overrideWindow) && (overrideWindow ?? 0) > 0
        ? overrideWindow
        : undefined,
    );
    logger.log(
      `Done. repsUpdated=${result.repsUpdated} committeesUpdated=${result.committeesUpdated}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Activity summary generation failed:', err);
  process.exit(1);
});
