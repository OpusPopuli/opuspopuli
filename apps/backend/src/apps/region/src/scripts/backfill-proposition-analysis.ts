/**
 * One-off backfill: generate AI analysis for every proposition that has
 * fullText and either no analysis yet, or an analysis written under a
 * different prompt.
 *
 * The second case is how a template revision takes effect — generateMissing()
 * compares each row's stored analysisPromptHash against the hash
 * prompt-service returns today and regenerates the mismatches. Until #1212 S5
 * it selected only rows with no analysis at all, so a revised prompt
 * regenerated nothing while this comment claimed otherwise.
 *
 * NOT covered: a proposition whose text was edited after its analysis was
 * written. That is a different staleness axis (#1207 item 2, bind claims to
 * the text version they cite); the single-proposition generate() path checks
 * it, this batch path does not.
 *
 * Usage:
 *   pnpm --filter backend build:region
 *   node dist/src/apps/region/apps/region/src/scripts/backfill-proposition-analysis.js
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
