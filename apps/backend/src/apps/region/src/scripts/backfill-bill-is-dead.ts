/**
 * One-off backfill: compute `Bill.isDead` and `Bill.isActive` for every
 * existing bill using the same rules the sync write path uses (#747).
 * Idempotent — re-runs are safe since both rules are deterministic.
 *
 * The logic lives in `refreshBillLifecycleFlags` (F4), which every bills
 * sync now also runs in its stage_backfill phase — so this script is for a
 * node that has not synced bills since deploy, or a dry run to see what a
 * sync would flip.
 *
 * Usage:
 *   pnpm --filter backend build:region
 *   node dist/src/apps/region/apps/region/src/scripts/backfill-bill-is-dead.js
 *
 * Optional flags (via env):
 *   BACKFILL_IS_DEAD_REGION_ID=california  — limit to a single region.
 *   BACKFILL_IS_DEAD_BATCH=200             — rows per page (default 200).
 *   BACKFILL_IS_DEAD_DRY_RUN=1             — log decisions; skip writes.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { refreshBillLifecycleFlags } from '../domains/bill-lifecycle-writer';
import { computeActiveCaSessionYears } from '../domains/bill-lifecycle';

async function main(): Promise<void> {
  const logger = new Logger('backfill-bill-is-dead');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const db = app.get(DbService, { strict: false });
    const today = new Date();
    const regionId = process.env.BACKFILL_IS_DEAD_REGION_ID || undefined;
    const batchSize = Number(process.env.BACKFILL_IS_DEAD_BATCH) || undefined;
    const dryRun = process.env.BACKFILL_IS_DEAD_DRY_RUN === '1';

    logger.log(
      `Backfill starting: regionId=${regionId ?? 'ALL'} batch=${batchSize ?? 'default'} dryRun=${dryRun} activeSessionYears=${computeActiveCaSessionYears(today).join(',')}`,
    );
    const counts = await refreshBillLifecycleFlags(db, {
      regionId,
      batchSize,
      dryRun,
      today,
    });
    logger.log(
      `Backfill complete: scanned=${counts.scanned} flippedDead=${counts.flippedDead} flippedActive=${counts.flippedActive} dryRun=${dryRun}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
