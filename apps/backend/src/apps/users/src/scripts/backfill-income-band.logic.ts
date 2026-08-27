/**
 * Decision logic for the income backfill (#1071), deliberately separated from
 * the script that runs it.
 *
 * The split exists so tests can import these rules WITHOUT dragging in
 * `AppModule`. The first version put them in the script itself; the spec
 * imported from there, and although `main()` was guarded with
 * `require.main === module`, the top-level `import { AppModule }` still
 * evaluated the whole Nest application graph inside the Jest worker. That
 * survived locally, where a database and config happened to be present, and
 * killed the worker on a clean CI runner:
 *
 *   Jest worker encountered 4 child process exceptions, exceeding retry limit
 *
 * Nothing in this file may import AppModule, NestFactory, or anything that
 * bootstraps. `SensitiveProfileService` is imported as a TYPE only, for the
 * same reason.
 */

import { Logger } from '@nestjs/common';
import type { SensitiveProfileService } from '../domains/personalization/sensitive-profile.service';

/**
 * `IncomeRange` (GraphQL keys UNDER_25K…) is stored lowercase in Postgres — the
 * GraphQL layer exposes enum KEYS while the database holds VALUES. The same
 * confusion made the first draft of the companion SQL migration a silent no-op.
 * Keys here are the stored values, verified against `pg_enum`.
 *
 * Those values are byte-identical to the `incomeBand` vocabulary, so this is an
 * identity map. It is written out explicitly rather than passed through, so a
 * band added to `IncomeRange` later cannot silently flow into the T3 payload
 * without someone deciding it should.
 *
 * `prefer_not_to_say` has no target and is deliberately absent: it is a refusal
 * to answer, not an answer.
 */
export const INCOME_BAND_BY_RANGE: Readonly<Record<string, string>> = {
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

export interface Counters {
  scanned: number;
  written: number;
  skippedAlreadySet: number;
  skippedNoFieldsMode: number;
  skippedUnmappable: number;
  failed: number;
}

export interface LegacyRow {
  userId: string;
  incomeRange: string | null;
}

/** Only the two methods the backfill needs, so tests can stub cheaply. */
export type SensitiveWriter = Pick<
  SensitiveProfileService,
  'getState' | 'updatePayload'
>;

/**
 * The per-row decision. Writes go through `updatePayload`, which already
 * refuses when `noFieldsMode` is on — a user who set that toggle is honoured by
 * reusing the rule rather than re-deriving it here.
 */
export async function decideAndApply(
  userId: string,
  incomeRange: string | null,
  sensitive: SensitiveWriter,
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

const COUNTER_BY_OUTCOME: Record<RowOutcome, keyof Counters> = {
  written: 'written',
  alreadySet: 'skippedAlreadySet',
  noFieldsMode: 'skippedNoFieldsMode',
  unmappable: 'skippedUnmappable',
};

export async function processRow(
  row: LegacyRow,
  sensitive: SensitiveWriter,
  dryRun: boolean,
  counters: Counters,
  failedUserIds: string[],
  logger: Logger,
): Promise<void> {
  try {
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
  } catch (err) {
    // One bad row must not abandon the rest of the table half-migrated.
    // The known cause: EncryptionService.decrypt throws when a row's
    // keyVersion is not the current one ("Key-rotation read path is a planned
    // follow-up"). The run is idempotent, so re-running after the cause is
    // fixed picks up exactly what was missed.
    //
    // The message is logged, the payload is NOT: this is CCPA/CPRA personal
    // information and an error string is not a place for it.
    counters.failed++;
    failedUserIds.push(row.userId);
    logger.error(
      `Row failed for user ${row.userId}: ${(err as Error).message}`,
    );
  }
}
