/**
 * One-off: run LegislativeCommitteeLinkerService.linkAll() against the
 * Representative.committees JSON already in the DB. Useful for:
 *
 * - Backfilling the new LegislativeCommittee + RepresentativeCommitteeAssignment
 *   tables on first deploy without waiting for the next scrape cycle.
 * - Re-running after a manual edit to Representative.committees.
 * - Re-running after a tweak to the name-normalization or role-canonicalization
 *   logic so the linker collapses additional variants.
 *
 * Usage (after `pnpm --filter backend build:region`):
 *   node apps/backend/dist/src/apps/region/apps/region/src/scripts/run-legislative-committee-linker.js
 *
 * Idempotent: re-running over unchanged data produces zero writes thanks
 * to the unique constraints on (legislative_committees.external_id) and
 * (representative_committee_assignments.{representative_id, legislative_committee_id}).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { LegislativeCommitteeLinkerService } from '../domains/legislative-committee-linker.service';

async function main(): Promise<void> {
  const logger = new Logger('run-legislative-committee-linker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const linker = app.get(LegislativeCommitteeLinkerService, {
      strict: false,
    });
    logger.log('Starting legislative committee linker pass…');
    const result = await linker.linkAll();
    logger.log(
      `Done. committeesUpserted=${result.committeesUpserted} ` +
        `assignmentsUpserted=${result.assignmentsUpserted} ` +
        `repsScanned=${result.repsScanned} skipped=${result.skipped}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Linker run failed:', err);
  process.exit(1);
});
