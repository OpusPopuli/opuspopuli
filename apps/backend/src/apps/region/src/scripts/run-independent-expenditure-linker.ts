/**
 * One-off: run IndependentExpenditureLinkerService.linkAll() against the data
 * already in the DB — attribute independent expenditures (S496 line items) to
 * their committee + target via the Form 496 cover pages, WITHOUT re-triggering a
 * full campaign-finance sync.
 *
 * Note: unlike the candidate-committee linker, this only helps once the S496
 * rows + cvr_filings cover pages are present. If a deploy predates the #955
 * ingestion mappings, run a full finance sync first so those rows exist, then
 * this script (or a later sync) resolves them. Idempotent: only IEs with a null
 * committeeId are considered, so re-running is safe.
 *
 * Usage (after `pnpm --filter backend build:region`):
 *   node apps/backend/dist/src/apps/region/apps/region/src/scripts/run-independent-expenditure-linker.js
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { IndependentExpenditureLinkerService } from '../domains/independent-expenditure-linker.service';

async function main(): Promise<void> {
  const logger = new Logger('run-independent-expenditure-linker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const linker = app.get(IndependentExpenditureLinkerService, {
      strict: false,
    });
    logger.log('Starting independent-expenditure linker pass…');
    const result = await linker.linkAll();
    logger.log(
      `Done. linked=${result.linked} ` +
        `noCoverPage=${result.skippedNoCoverPage} ` +
        `noCommittee=${result.skippedNoCommittee} ` +
        `(of ${result.considered} unresolved IEs)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Linker run failed:', err);
  process.exit(1);
});
