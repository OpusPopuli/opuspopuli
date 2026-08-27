/**
 * One-off backfill: carry `UserProfile.incomeRange` into the T3
 * `SensitiveProfile.incomeBand` (issue OpusPopuli/opuspopuli#1071, plan
 * subtask 2).
 *
 * Why this is a script and not SQL: `incomeBand` lives inside a single
 * AES-256-GCM `encryptedPayload` column, so it cannot be reached from the
 * migration that backfills the other fields. The ciphertext must be decrypted,
 * amended and re-encrypted through the application's own EncryptionService.
 *
 * Safety properties, all deliberate:
 *
 *   1. Writes go through `SensitiveProfileService.updatePayload`, which already
 *      refuses to write when `noFieldsMode` is on. A user who set that toggle
 *      has explicitly asked for nothing to be stored; this backfill honours it
 *      rather than re-deriving the rule.
 *   2. Your Model wins: a row that already has an `incomeBand` is never
 *      overwritten (plan decision 2).
 *   3. No plaintext ever leaves the process — no temp table, no file, no
 *      logging of values. Output is counters and user ids only. `incomeRange`
 *      is CCPA/CPRA personal information; the whole point of the T3 payload is
 *      that it does not sit in the clear.
 *   4. Idempotent. Re-running skips everyone it already migrated, because they
 *      now have an `incomeBand`.
 *
 * Usage — note the doubled path, which is what `users/tsconfig.app.json`
 * actually emits (outDir dist/src/apps/users, sources under src/apps/users/src):
 *
 *   pnpm --filter backend build:users
 *   node dist/src/apps/users/apps/users/src/scripts/backfill-income-band.js
 *
 * Run the dry pass first and read the counters before the real one:
 *   BACKFILL_INCOME_DRY_RUN=1 node dist/src/apps/users/apps/users/src/scripts/backfill-income-band.js
 *
 * Flags (via env):
 *   BACKFILL_INCOME_DRY_RUN=1   — report decisions, write nothing. RUN THIS FIRST.
 *   BACKFILL_INCOME_BATCH=200   — rows per page (default 200).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { SensitiveProfileService } from '../domains/personalization/sensitive-profile.service';

const DEFAULT_BATCH = 200;

/**
 * `IncomeRange` (GraphQL keys UNDER_25K…) is stored lowercase in Postgres, the
 * same trap that made the first draft of the companion SQL migration a silent
 * no-op — the GraphQL layer exposes enum KEYS while the database holds VALUES.
 * Keys here are the stored values.
 *
 * The stored values are byte-identical to the `incomeBand` vocabulary, so this
 * is an identity map. It is written out explicitly rather than passed through,
 * so that a band added to `IncomeRange` later cannot silently flow into the T3
 * payload without someone deciding it should.
 *
 * `prefer_not_to_say` has no target and is deliberately absent: it is a refusal
 * to answer, not an answer.
 */
const INCOME_BAND_BY_RANGE: Readonly<Record<string, string>> = {
  under_25k: 'under_25k',
  '25k_50k': '25k_50k',
  '50k_75k': '50k_75k',
  '75k_100k': '75k_100k',
  '100k_150k': '100k_150k',
  '150k_200k': '150k_200k',
  over_200k: 'over_200k',
};

export type RowOutcome =
  | 'written'
  | 'alreadySet'
  | 'noFieldsMode'
  | 'unmappable';

/**
 * The per-row decision, exported so the integration spec exercises THIS code
 * rather than a copy of it. The first version of that spec re-implemented these
 * rules inline, which meant the tests would keep passing if the script drifted.
 */
export async function decideAndApply(
  userId: string,
  incomeRange: string | null,
  sensitive: Pick<SensitiveProfileService, 'getState' | 'updatePayload'>,
  dryRun = false,
): Promise<RowOutcome> {
  const target = incomeRange ? INCOME_BAND_BY_RANGE[incomeRange] : undefined;
  // prefer_not_to_say, or a band added after this script was written.
  if (!target) return 'unmappable';

  // getState returns noFieldsMode alongside the decrypted payload, so one read
  // answers both "may I write?" and "is it already set?".
  const state = await sensitive.getState(userId);
  if (state.noFieldsMode) return 'noFieldsMode';
  if (state.payload?.incomeBand) return 'alreadySet';
  if (dryRun) return 'written';

  await sensitive.updatePayload(userId, {
    ...(state.payload ?? {}),
    incomeBand: target,
  });
  return 'written';
}

interface Counters {
  scanned: number;
  written: number;
  skippedAlreadySet: number;
  skippedNoFieldsMode: number;
  skippedUnmappable: number;
}

interface LegacyRow {
  userId: string;
  incomeRange: string | null;
}

async function fetchBatch(
  db: DbService,
  batchSize: number,
  cursor: string | undefined,
): Promise<LegacyRow[]> {
  const rows = await db.userProfile.findMany({
    where: {
      incomeRange: { not: null },
      ...(cursor ? { userId: { gt: cursor } } : {}),
    },
    select: { userId: true, incomeRange: true },
    orderBy: { userId: 'asc' },
    take: batchSize,
  });
  return rows.map((r) => ({
    userId: r.userId,
    incomeRange: r.incomeRange as string | null,
  }));
}

const COUNTER_BY_OUTCOME: Record<RowOutcome, keyof Counters> = {
  written: 'written',
  alreadySet: 'skippedAlreadySet',
  noFieldsMode: 'skippedNoFieldsMode',
  unmappable: 'skippedUnmappable',
};

async function processRow(
  row: LegacyRow,
  sensitive: SensitiveProfileService,
  dryRun: boolean,
  counters: Counters,
  logger: Logger,
): Promise<void> {
  const outcome = await decideAndApply(
    row.userId,
    row.incomeRange,
    sensitive,
    dryRun,
  );

  if (dryRun && outcome === 'written') {
    // Deliberately logs the user id and NOT the band.
    logger.log(`[dry-run] would set incomeBand for user ${row.userId}`);
  }

  counters[COUNTER_BY_OUTCOME[outcome]]++;
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillIncomeBand');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const db = app.get(DbService);
    const sensitive = app.get(SensitiveProfileService);

    const dryRun = process.env.BACKFILL_INCOME_DRY_RUN === '1';
    const batchSize = Number(
      process.env.BACKFILL_INCOME_BATCH ?? DEFAULT_BATCH,
    );

    const counters: Counters = {
      scanned: 0,
      written: 0,
      skippedAlreadySet: 0,
      skippedNoFieldsMode: 0,
      skippedUnmappable: 0,
    };

    logger.log(`Income backfill starting: batch=${batchSize} dryRun=${dryRun}`);

    let cursor: string | undefined;
    for (;;) {
      const rows = await fetchBatch(db, batchSize, cursor);
      if (rows.length === 0) break;

      for (const row of rows) {
        await processRow(row, sensitive, dryRun, counters, logger);
      }

      counters.scanned += rows.length;
      cursor = rows[rows.length - 1].userId;
      logger.log(
        `Progress: scanned=${counters.scanned} written=${counters.written} ` +
          `alreadySet=${counters.skippedAlreadySet} noFieldsMode=${counters.skippedNoFieldsMode} ` +
          `unmappable=${counters.skippedUnmappable}`,
      );
    }

    logger.log(
      `Income backfill complete: scanned=${counters.scanned} written=${counters.written} ` +
        `alreadySet=${counters.skippedAlreadySet} noFieldsMode=${counters.skippedNoFieldsMode} ` +
        `unmappable=${counters.skippedUnmappable} dryRun=${dryRun}`,
    );
  } finally {
    await app.close();
  }
}

// Only run when executed directly. Without this guard, importing
// `decideAndApply` from the integration spec would boot a Nest application
// context as a side effect of the import.
if (require.main === module) {
  main().catch((err) => {
    console.error('Income backfill failed:', err);
    process.exit(1);
  });
}
