/**
 * The one way to write a bill's lifecycle inputs (F4,
 * `docs/plans/ingestion-resource-lanes.md` §5.1).
 *
 * `isDead` / `isActive` are derived from four columns — `status`,
 * `lastAction`, `lastActionDate`, `currentStageId` — plus the date. Until F4
 * only the extraction upsert recomputed them, so the summary pass and
 * `stage_backfill` could change a bill's stage and leave its flags behind.
 * That mislabelled a bill only until its next extraction; once cold bills are
 * frozen (K5) there is no next extraction, and hot/cold is decided from these
 * flags. `bill-lifecycle-writer.enforcement.spec.ts` keeps every other writer
 * out.
 *
 * Kept apart from `bill-lifecycle.ts`, which stays pure: that module decides,
 * this one reads and writes.
 */

import type { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  computeActiveCaSessionYears,
  isBillActive,
  isBillDead,
  type BillLifecycleInput,
} from './bill-lifecycle';

/** A bill's current lifecycle inputs, as the writers below need them. */
export type BillLifecycleRow = BillLifecycleInput & { id: string };

/** Select exactly the columns a {@link BillLifecycleRow} needs. */
export const BILL_LIFECYCLE_SELECT = {
  id: true,
  status: true,
  currentStageId: true,
  sessionYear: true,
  lastAction: true,
  lastActionDate: true,
} as const;

/**
 * The inputs a writer may change. `sessionYear` is not one of them: it is
 * part of the bill's identity, set at extraction, never patched.
 */
export type BillLifecyclePatch = Partial<
  Pick<
    BillLifecycleInput,
    'status' | 'lastAction' | 'lastActionDate' | 'currentStageId'
  >
>;

/**
 * The caller's other columns. Lifecycle inputs and flags are excluded by
 * TYPE, so a summary payload cannot carry a `status` or an `isDead` around
 * the recompute — the hole the source-scanning enforcement spec cannot see.
 */
export type BillNonLifecycleUpdate = Omit<
  Prisma.BillUpdateInput,
  | 'status'
  | 'lastAction'
  | 'lastActionDate'
  | 'currentStageId'
  | 'isDead'
  | 'isActive'
>;

export interface BillLifecycleFlags {
  isDead: boolean;
  isActive: boolean;
}

/** Both flags, from one snapshot of the date so they cannot disagree. */
export function lifecycleFlags(
  bill: BillLifecycleInput,
  today: Date,
): BillLifecycleFlags {
  const ctx = { today, activeSessionYears: computeActiveCaSessionYears(today) };
  return { isDead: isBillDead(bill, ctx), isActive: isBillActive(bill, ctx) };
}

/**
 * Patch a bill's lifecycle inputs and recompute both flags in the same
 * update.
 *
 * `current` is the row as the caller already loaded it (select
 * {@link BILL_LIFECYCLE_SELECT}) — the flags depend on the inputs the patch
 * does NOT touch, so they have to come from somewhere, and every caller
 * already has them. `undefined` in the patch means "leave alone", exactly as
 * Prisma reads it; `null` clears.
 *
 * `extra` carries the caller's other columns (a summary, its provenance) so
 * the whole write stays one statement.
 *
 * **Conditional on the inputs it read.** The summary pass loads its bills,
 * then spends minutes in the LLM before writing; a concurrent sync can change
 * `status` or `lastActionDate` meanwhile, and flags computed from the stale
 * read would no longer describe the row — the inconsistency this module
 * exists to prevent. So the update matches on `current`'s inputs too; on a
 * mismatch the row is re-read and the flags recomputed once. The patch itself
 * still wins (last writer wins on the inputs, as before); what is guaranteed
 * is that the flags describe the row as written.
 */
export async function writeBillLifecycleFields(
  db: DbService,
  current: BillLifecycleRow,
  patch: BillLifecyclePatch,
  extra: BillNonLifecycleUpdate = {},
  today: Date = new Date(),
): Promise<void> {
  const changes = definedOnly(patch);
  const write = (row: BillLifecycleRow) =>
    db.bill.update({
      where: unchangedSince(row),
      data: {
        ...extra,
        ...changes,
        ...lifecycleFlags({ ...row, ...changes }, today),
      },
    });

  try {
    await write(current);
  } catch (error) {
    if (!isRowNotMatched(error)) throw error;
    const fresh = await db.bill.findUnique({
      where: { id: current.id },
      select: BILL_LIFECYCLE_SELECT,
    });
    // Deleted underneath us — nothing left to label.
    if (!fresh) return;
    await write(fresh);
  }
}

/**
 * `where` for "this bill, still holding the inputs I read". Prisma 5 accepts
 * non-unique fields beside the unique `id` on `update`, and throws P2025 when
 * nothing matches.
 */
function unchangedSince(row: BillLifecycleRow): Prisma.BillWhereUniqueInput {
  return {
    id: row.id,
    status: row.status,
    lastAction: row.lastAction,
    lastActionDate: row.lastActionDate,
    currentStageId: row.currentStageId,
  };
}

/** Prisma's "record to update not found" — here, "changed since read". */
function isRowNotMatched(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2025';
}

function definedOnly(patch: BillLifecyclePatch): BillLifecyclePatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as BillLifecyclePatch;
}

export interface LifecycleRefreshOptions {
  regionId?: string;
  batchSize?: number;
  dryRun?: boolean;
  today?: Date;
}

export interface LifecycleRefreshCounts {
  scanned: number;
  flippedDead: number;
  flippedActive: number;
}

const DEFAULT_REFRESH_BATCH = 200;

/**
 * Recompute every bill's flags against today, writing only the rows whose
 * answer changed.
 *
 * Needed because the flags move with the DATE as well as with the inputs:
 * when a session closes, every unfinished bill in it becomes dead by the
 * session-expired rule, but none of them is written again — the source has
 * stopped listing them. Without a pass like this they stay `isActive=true`
 * forever. No LLM and no fetch, so it is cheap enough to run every bills
 * sync; the `backfill-bill-is-dead` script runs the same function by hand.
 */
export async function refreshBillLifecycleFlags(
  db: DbService,
  opts: LifecycleRefreshOptions = {},
): Promise<LifecycleRefreshCounts> {
  const today = opts.today ?? new Date();
  const batchSize = opts.batchSize ?? DEFAULT_REFRESH_BATCH;
  const counts: LifecycleRefreshCounts = {
    scanned: 0,
    flippedDead: 0,
    flippedActive: 0,
  };

  let cursor: string | undefined;
  for (;;) {
    const rows = await db.bill.findMany({
      where: opts.regionId ? { regionId: opts.regionId } : undefined,
      select: { ...BILL_LIFECYCLE_SELECT, isDead: true, isActive: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      await refreshRow(db, row, today, opts.dryRun ?? false, counts);
    }
    counts.scanned += rows.length;
    cursor = rows[rows.length - 1].id;
  }
  return counts;
}

/**
 * Per row, not `updateMany`: different bills need different column
 * combinations — a dead flip, an active flip, both, or nothing.
 */
async function refreshRow(
  db: DbService,
  row: BillLifecycleRow & BillLifecycleFlags,
  today: Date,
  dryRun: boolean,
  counts: LifecycleRefreshCounts,
): Promise<void> {
  const next = lifecycleFlags(row, today);
  const flipDead = next.isDead !== row.isDead;
  const flipActive = next.isActive !== row.isActive;
  if (!flipDead && !flipActive) return;
  if (!dryRun) {
    try {
      await db.bill.update({
        // Conditional on what was read, flags included: a row a concurrent
        // writer touched mid-page is left for the next sync rather than
        // given flags computed from its old inputs.
        where: {
          ...unchangedSince(row),
          isDead: row.isDead,
          isActive: row.isActive,
        },
        data: {
          ...(flipDead && { isDead: next.isDead }),
          ...(flipActive && { isActive: next.isActive }),
        },
      });
    } catch (error) {
      if (isRowNotMatched(error)) return;
      throw error;
    }
  }
  if (flipDead) counts.flippedDead += 1;
  if (flipActive) counts.flippedActive += 1;
}
