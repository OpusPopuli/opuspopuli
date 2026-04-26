/**
 * One-off: run PropositionFinanceLinkerService.linkAll() against the data
 * already in the DB. Useful for:
 *
 * - Validating the inferred-position path on real CalAccess data without
 *   re-triggering a full campaign-finance sync (which is expensive and
 *   re-fetches federal data we don't need to re-test).
 * - Re-resolving propositionTitle → propositionId after new propositions
 *   are added (e.g. when an election cycle adds measures the prior sync
 *   missed).
 * - Re-processing cvr2_filings independently of the bulk-download cycle.
 *
 * Usage (after `pnpm --filter backend build:region`):
 *   node apps/backend/dist/src/apps/region/apps/region/src/scripts/run-finance-linker.js
 *
 * Idempotent: re-running over the same data is a no-op thanks to the
 * unique constraint on (committee_id, proposition_id, position).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PropositionFinanceLinkerService } from '../domains/proposition-finance-linker.service';

async function main(): Promise<void> {
  const logger = new Logger('run-finance-linker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const linker = app.get(PropositionFinanceLinkerService, { strict: false });
    logger.log('Starting proposition finance linker pass…');
    const result = await linker.linkAll();
    logger.log(
      `Done. cvr2Resolved=${result.cvr2Resolved} cvr2Skipped=${result.cvr2Skipped} ` +
        `expenditureLinked=${result.expenditureLinked} ` +
        `independentExpenditureLinked=${result.independentExpenditureLinked} ` +
        `inferredPositions=${result.inferredPositions}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Linker run failed:', err);
  process.exit(1);
});
