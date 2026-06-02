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
  type BillLifecycleContext,
} from '../domains/bill-lifecycle';

const DEFAULT_BATCH = 200;

interface BackfillConfig {
  regionId: string | undefined;
  batchSize: number;
  dryRun: boolean;
  lifecycleCtx: BillLifecycleContext;
}

interface BackfillCounters {
  scanned: number;
  flippedDead: number;
  flippedActive: number;
}

type LifecycleRow = {
  id: string;
  status: string | null;
  currentStageId: string | null;
  sessionYear: string;
  lastAction: string | null;
  lastActionDate: Date | null;
  isDead: boolean;
  isActive: boolean;
};

function loadConfig(): BackfillConfig {
  const today = new Date();
  return {
    regionId: process.env.BACKFILL_IS_DEAD_REGION_ID || undefined,
    batchSize: Number(process.env.BACKFILL_IS_DEAD_BATCH) || DEFAULT_BATCH,
    dryRun: process.env.BACKFILL_IS_DEAD_DRY_RUN === '1',
    lifecycleCtx: {
      today,
      activeSessionYears: computeActiveCaSessionYears(today),
    },
  };
}

async function fetchBatch(
  db: DbService,
  cfg: BackfillConfig,
  cursor: string | undefined,
): Promise<LifecycleRow[]> {
  return db.bill.findMany({
    where: cfg.regionId ? { regionId: cfg.regionId } : undefined,
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
    take: cfg.batchSize,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}

/**
 * Decide which columns (if any) need flipping for the row. Returns null
 * when both flags already match the helper output (no-op).
 */
function planRowUpdate(
  row: LifecycleRow,
  cfg: BackfillConfig,
): { isDead?: boolean; isActive?: boolean } | null {
  const dead = isBillDead(row, cfg.lifecycleCtx);
  const active = isBillActive(row, cfg.lifecycleCtx);
  const needsDead = dead !== row.isDead;
  const needsActive = active !== row.isActive;
  if (!needsDead && !needsActive) return null;
  return {
    ...(needsDead && { isDead: dead }),
    ...(needsActive && { isActive: active }),
  };
}

async function processBatch(
  db: DbService,
  cfg: BackfillConfig,
  rows: LifecycleRow[],
  counters: BackfillCounters,
): Promise<void> {
  // Per-row update — different bills may need different column combinations
  // (dead-flip, active-flip, both, or no-op). updateMany is only safe for
  // uniform payloads.
  for (const row of rows) {
    const update = planRowUpdate(row, cfg);
    if (!update) continue;
    if (!cfg.dryRun) {
      await db.bill.update({ where: { id: row.id }, data: update });
    }
    if (update.isDead !== undefined) counters.flippedDead += 1;
    if (update.isActive !== undefined) counters.flippedActive += 1;
  }
}

async function main(): Promise<void> {
  const logger = new Logger('backfill-bill-is-dead');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const db = app.get(DbService, { strict: false });
    const cfg = loadConfig();
    const counters: BackfillCounters = {
      scanned: 0,
      flippedDead: 0,
      flippedActive: 0,
    };

    logger.log(
      `Backfill starting: regionId=${cfg.regionId ?? 'ALL'} batch=${cfg.batchSize} dryRun=${cfg.dryRun} activeSessionYears=${cfg.lifecycleCtx.activeSessionYears.join(',')}`,
    );

    let cursor: string | undefined;
    for (;;) {
      const rows = await fetchBatch(db, cfg, cursor);
      if (rows.length === 0) break;
      await processBatch(db, cfg, rows, counters);
      counters.scanned += rows.length;
      cursor = rows[rows.length - 1].id;
      logger.log(
        `Progress: scanned=${counters.scanned} flippedDead=${counters.flippedDead} flippedActive=${counters.flippedActive} lastId=${cursor}`,
      );
    }

    logger.log(
      `Backfill complete: scanned=${counters.scanned} flippedDead=${counters.flippedDead} flippedActive=${counters.flippedActive} dryRun=${cfg.dryRun}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
