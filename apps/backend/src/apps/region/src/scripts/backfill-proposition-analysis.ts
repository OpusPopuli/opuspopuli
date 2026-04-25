/**
 * One-off backfill: generate AI analysis for every proposition that has
 * fullText but no analysis yet. Also handles the case where the prompt
 * template has been revised and the existing analyses are now stale
 * (the isCurrent() check inside PropositionAnalysisService compares the
 * stored analysisPromptHash against the live prompt-service hash).
 *
 * Usage:
 *   pnpm --filter backend build:region
 *   node dist/apps/region/src/scripts/backfill-proposition-analysis.js
 *
 * Optional flags (via env):
 *   PROPOSITION_ANALYSIS_MAX_PROPS=N — cap the batch size for a partial run.
 *
 * The script bootstraps the Region subapp's NestJS context so the same
 * PromptClientService, LLM provider, and DB wiring used at runtime are
 * reused here. Nothing about this script is configured differently — it
 * simply exercises PropositionAnalysisService.generateMissing().
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PropositionAnalysisService } from '../domains/proposition-analysis.service';

async function main(): Promise<void> {
  const logger = new Logger('backfill-proposition-analysis');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const analyzer = app.get(PropositionAnalysisService, { strict: false });
    logger.log('Starting proposition analysis backfill…');
    await analyzer.generateMissing();
    logger.log('Backfill complete.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
