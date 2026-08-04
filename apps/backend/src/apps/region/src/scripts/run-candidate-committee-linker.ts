/**
 * One-off: run CandidateCommitteeLinkerService.linkAll() against the data
 * already in the DB — re-attribute candidate committees to representatives
 * WITHOUT re-triggering a full campaign-finance sync (which re-downloads
 * hundreds of thousands of CAL-ACCESS rows we don't need to re-fetch).
 *
 * Use after deploying a linker change (e.g. #953: the candidate_name surname
 * extraction + relaxed type gate) to re-link existing committees and see the
 * new yield. Idempotent and self-healing: it only links unlinked committees
 * and its reconcile pass unlinks any stale attribution, so it is safe to
 * re-run.
 *
 * Usage (after `pnpm --filter backend build:region`):
 *   node apps/backend/dist/src/apps/region/apps/region/src/scripts/run-candidate-committee-linker.js
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CandidateCommitteeLinkerService } from '../domains/candidate-committee-linker.service';

async function main(): Promise<void> {
  const logger = new Logger('run-candidate-committee-linker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const linker = app.get(CandidateCommitteeLinkerService, { strict: false });
    logger.log('Starting candidate-committee linker pass…');
    const result = await linker.linkAll();
    logger.log(
      `Done. linked=${result.linked} ` +
        `ambiguous=${result.skippedAmbiguous} ` +
        `nonControlled=${result.skippedNonControlled} ` +
        `reconciledUnlinked=${result.reconciledUnlinked} ` +
        `unmatched=${result.unmatched} ` +
        `(of ${result.candidateCommittees} committees considered)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Linker run failed:', err);
  process.exit(1);
});
