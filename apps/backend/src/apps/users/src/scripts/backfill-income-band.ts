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
 * The dry pass is safe to run against production directly: it returns before
 * `updatePayload` is ever called, so it writes nothing and simply reports the
 * counters over real data.
 *
 * Failures are per-row, not fatal. A row that cannot be decrypted is counted,
 * its user id recorded, and the run continues — the known cause is a row whose
 * `keyVersion` is not the current one, which EncryptionService refuses. The run
 * is idempotent, so once the cause is fixed, re-running retries exactly the
 * rows that were missed. If failures reach `maxFailures` the run abandons and
 * exits non-zero, because that many means something systemic rather than a few
 * bad rows.
 *
 * Worth checking before the real pass:
 *   SELECT key_version, count(*) FROM sensitive_profiles GROUP BY 1;
 *
 * Flags (via env):
 *   BACKFILL_INCOME_DRY_RUN=1      — report decisions, write nothing. RUN THIS FIRST.
 *   BACKFILL_INCOME_BATCH=200      — rows per page (default 200).
 *   BACKFILL_INCOME_MAX_FAILURES=25 — abandon after this many row failures.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { SensitiveProfileService } from '../domains/personalization/sensitive-profile.service';
import {
  processRow,
  type Counters,
  type LegacyRow,
} from './backfill-income-band.logic';

// The decision rules live in ./backfill-income-band.logic so tests can import
// them without evaluating AppModule — see the note at the top of that file.
export * from './backfill-income-band.logic';

const DEFAULT_BATCH = 200;

/**
 * How many rows may fail before the run gives up.
 *
 * A handful of undecryptable rows should not stop the other thousands from
 * being migrated. But a systemic fault — the wrong key, a schema change —
 * fails every row, and grinding through the whole table logging errors is
 * worse than stopping early and telling someone.
 */
const DEFAULT_MAX_FAILURES = 25;

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
    const maxFailures = Number(
      process.env.BACKFILL_INCOME_MAX_FAILURES ?? DEFAULT_MAX_FAILURES,
    );

    const counters: Counters = {
      scanned: 0,
      written: 0,
      skippedAlreadySet: 0,
      skippedNoFieldsMode: 0,
      skippedUnmappable: 0,
      failed: 0,
    };
    const failedUserIds: string[] = [];
    const summary = () =>
      `scanned=${counters.scanned} written=${counters.written} ` +
      `alreadySet=${counters.skippedAlreadySet} noFieldsMode=${counters.skippedNoFieldsMode} ` +
      `unmappable=${counters.skippedUnmappable} failed=${counters.failed}`;

    logger.log(
      `Income backfill starting: batch=${batchSize} dryRun=${dryRun} maxFailures=${maxFailures}`,
    );

    let cursor: string | undefined;
    let abandoned = false;

    for (;;) {
      const rows = await fetchBatch(db, batchSize, cursor);
      if (rows.length === 0) break;

      for (const row of rows) {
        await processRow(
          row,
          sensitive,
          dryRun,
          counters,
          failedUserIds,
          logger,
        );
        counters.scanned++;

        if (counters.failed >= maxFailures) {
          logger.error(
            `Aborting: ${counters.failed} rows failed, at or above maxFailures=${maxFailures}. ` +
              `This looks systemic rather than a few bad rows — check the ` +
              `SENSITIVE_PROFILE_ENCRYPTION_KEY and key_version before re-running.`,
          );
          abandoned = true;
          break;
        }
      }

      if (abandoned) break;

      cursor = rows[rows.length - 1].userId;
      logger.log(`Progress: ${summary()}`);
    }

    logger.log(
      `Income backfill ${abandoned ? 'ABANDONED' : 'complete'}: ${summary()} dryRun=${dryRun}`,
    );

    if (failedUserIds.length > 0) {
      // Ids only — never the values. The run is idempotent, so re-running
      // after the cause is fixed retries exactly these and nothing else.
      logger.error(`Failed user ids: ${failedUserIds.join(', ')}`);
    }

    if (abandoned) {
      process.exitCode = 1;
    }
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
