/**
 * One-off backfill: compute `Bill.isDead` and `Bill.isActive` for every
 * existing bill using the same rules the sync write path uses (#747).
 * Idempotent — re-runs are safe since both rules are deterministic.
 *
 * One-way transitions: dead bills stay dead; an inactive bill that becomes
 * active again will be flipped back to true by the next sync (status string
 * changes drive the transition). This script only needs to run once per
 * region after deploy; ongoing hygiene happens via the regular sync.
 *
 * Usage:
 *   pnpm --filter backend build:region
 *   node dist/apps/region/src/scripts/backfill-bill-is-dead.js
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
import {
  isBillDead,
  isBillActive,
  computeActiveCaSessionYears,
} from '../domains/bill-lifecycle';

const DEFAULT_BATCH = 200;

async function main(): Promise<void> {
  const logger = new Logger('backfill-bill-is-dead');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const db = app.get(DbService, { strict: false });
    const regionId = process.env.BACKFILL_IS_DEAD_REGION_ID || undefined;
    const batchSize =
      Number(process.env.BACKFILL_IS_DEAD_BATCH) || DEFAULT_BATCH;
    const dryRun = process.env.BACKFILL_IS_DEAD_DRY_RUN === '1';

    const today = new Date();
    const activeSessionYears = computeActiveCaSessionYears(today);

    logger.log(
      `Backfill starting: regionId=${regionId ?? 'ALL'} batch=${batchSize} dryRun=${dryRun} activeSessionYears=${activeSessionYears.join(',')}`,
    );

    let cursor: string | undefined;
    let scanned = 0;
    let flippedDead = 0;
    let flippedActive = 0;

    for (;;) {
      const rows = await db.bill.findMany({
        where: regionId ? { regionId } : undefined,
        select: {
          id: true,
          status: true,
          currentStageId: true,
          sessionYear: true,
          lastAction: true,
          lastActionDate: true,
          isDead: true,
          isActive: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;

      // Per-row update — different bills may need different column
      // combinations (dead-flip, active-flip, both, or both-cleared if the
      // status changed mid-pipeline). updateMany is only safe for uniform
      // payloads.
      const lifecycleCtx = { today, activeSessionYears };
      for (const row of rows) {
        const dead = isBillDead(row, lifecycleCtx);
        const active = isBillActive(row, lifecycleCtx);
        const needsDead = dead !== row.isDead;
        const needsActive = active !== row.isActive;
        if (!needsDead && !needsActive) continue;
        if (!dryRun) {
          await db.bill.update({
            where: { id: row.id },
            data: {
              ...(needsDead && { isDead: dead }),
              ...(needsActive && { isActive: active }),
            },
          });
        }
        if (needsDead) flippedDead += 1;
        if (needsActive) flippedActive += 1;
      }

      scanned += rows.length;
      cursor = rows[rows.length - 1].id;
      logger.log(
        `Progress: scanned=${scanned} flippedDead=${flippedDead} flippedActive=${flippedActive} lastId=${cursor}`,
      );
    }

    logger.log(
      `Backfill complete: scanned=${scanned} flippedDead=${flippedDead} flippedActive=${flippedActive} dryRun=${dryRun}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
