/**
 * Procedural lifecycle classification for bills (#747).
 *
 * Two booleans, computed at sync write time, partition the corpus
 * into three phases that the UI and the personalized feed consume:
 *
 *   - isActive=true,  isDead=false → currently moveable; user can act
 *   - isActive=false, isDead=false → passed/chaptered (signed into law)
 *   - isActive=false, isDead=true  → vetoed, died, expired, etc.
 *
 * The bills-list Active/Inactive segmented toggle filters on isActive.
 * The personalized feed (#743/#745) hard-includes isActive=true only
 * — chaptered AND dead bills are equally unactionable in a "things you
 * can do something about" surface. isDead is retained for the bill-
 * detail banner (green vs amber) and admin/research callers.
 *
 * Design notes:
 *
 *   - **Pure**: no DB, no `Date.now()`. Caller passes `ctx.today`, so
 *     both helpers stay deterministic and the backfill script + the
 *     sync write path share one implementation.
 *
 *   - **Partition invariant**: `isBillActive` defers to `isBillDead` so
 *     a stale "Active Bill - ..." status on an expired-session bill
 *     can never satisfy both checks simultaneously.
 *
 *   - **Table-driven**: each dead-status signal is a row in
 *     `DEAD_STATUS_PATTERNS`. Adding a new state-specific phrase (or
 *     extending past CA) only touches the table — keeps cognitive
 *     complexity well under the SonarCloud gate.
 *
 *   - **Carryover guard**: CA two-year sessions allow bills to revive
 *     in year 2. The guard protects ONLY the soft session-expired
 *     heuristic — it does not absorb a same-year terminal status (a
 *     bill that died this year is still dead).
 *
 *   - **Re-evaluated on every sync**: helpers are deterministic, so
 *     re-runs are no-ops until the source status changes. Real CA bills
 *     don't un-die, so dead → active transitions don't happen in
 *     practice — but the code doesn't artificially block them either,
 *     which keeps recovery cheap if the source ever needs a re-import.
 */

export interface BillLifecycleInput {
  status: string | null;
  currentStageId: string | null;
  sessionYear: string;
  lastAction: string | null;
  lastActionDate: Date | null;
}

export interface BillLifecycleContext {
  /** Caller-supplied "now" so the function stays pure. */
  today: Date;
  /**
   * sessionYear labels (e.g. ["2025-2026"]) considered still in-session.
   * A bill whose sessionYear is NOT in this list and whose currentStageId
   * is not the terminal `chaptered` stage is dead by the "session
   * expired" rule.
   */
  activeSessionYears: string[];
}

/** Lifecycle stage IDs (from the civics data extracted into Bill.currentStageId)
 *  that signal a bill is procedurally dead. `chaptered` means *passed* and is
 *  NOT included — chaptered bills are enacted, not dead. */
const DEAD_STAGE_IDS: ReadonlySet<string> = new Set(['failed-passage']);

/** Regex patterns against the `status` column (covers both the LLM-
 *  normalized short form and the verbatim leginfo string — older rows
 *  may carry "Inactive Bill - Died" while newer ones carry "Died"). Each
 *  row is a single canonical signal. Veto is handled separately because
 *  an override in `lastAction` cancels it. */
const DEAD_STATUS_PATTERNS: readonly RegExp[] = [
  /died/i, // CA's canonical dead-bill marker ("Inactive Bill - Died")
  /failed deadline/i, // missed the committee/floor cutoff
  /inactive file/i, // moved to inactive file with no recall
  /withdrawn/i, // withdrawn by author
  /failed passage/i, // floor vote lost
];

const VETOED_PATTERN = /vetoed/i;
/** Matches "override", "overrode", "overridden", "overriding" — the stem
 *  `overrid` covers every conjugation we've seen in CA action history. */
const OVERRIDE_PATTERN = /overrid/i;

export function isBillDead(
  bill: BillLifecycleInput,
  ctx: BillLifecycleContext,
): boolean {
  // Hard terminal signals win unconditionally — a bill that died this year
  // is still dead. The carryover guard only protects against the soft
  // session-expired heuristic below it.
  if (matchesDeadStage(bill)) return true;
  if (matchesDeadStatus(bill)) return true;
  if (isSessionExpired(bill, ctx) && !isCarryoverLive(bill, ctx)) return true;
  return false;
}

function isCarryoverLive(
  bill: BillLifecycleInput,
  ctx: BillLifecycleContext,
): boolean {
  if (!bill.lastActionDate) return false;
  return bill.lastActionDate.getUTCFullYear() === ctx.today.getUTCFullYear();
}

function matchesDeadStage(bill: BillLifecycleInput): boolean {
  return !!bill.currentStageId && DEAD_STAGE_IDS.has(bill.currentStageId);
}

function matchesDeadStatus(bill: BillLifecycleInput): boolean {
  if (!bill.status) return false;
  if (DEAD_STATUS_PATTERNS.some((re) => re.test(bill.status!))) return true;
  if (VETOED_PATTERN.test(bill.status)) {
    // Veto + subsequent override = live again.
    const overridden =
      !!bill.lastAction && OVERRIDE_PATTERN.test(bill.lastAction);
    return !overridden;
  }
  return false;
}

function isSessionExpired(
  bill: BillLifecycleInput,
  ctx: BillLifecycleContext,
): boolean {
  if (ctx.activeSessionYears.includes(bill.sessionYear)) return false;
  // Chaptered bills from closed sessions are enacted, not dead.
  if (bill.currentStageId === 'chaptered') return false;
  return true;
}

/**
 * CA two-year session label for the given date — e.g. 2026-05-31 → "2025-2026".
 * Sessions start in odd-numbered years and run two calendar years. CA-only for
 * now; when we add a second state with a different cadence, move this behind
 * a region-config field.
 */
export function computeActiveCaSessionYears(today: Date): string[] {
  const year = today.getUTCFullYear();
  const startYear = year % 2 === 1 ? year : year - 1;
  return [`${startYear}-${startYear + 1}`];
}

/**
 * Returns true when the bill is *currently moveable* — the source has tagged
 * it as actively progressing through the legislature (CA leginfo prefixes
 * such bills with "Active Bill - ...") AND the bill is not procedurally
 * dead. The dead-check seals the partition: a stale "Active Bill - ..."
 * status on an expired-session bill (rare in real CA data, but possible
 * with corrupt or pre-update rows) would otherwise satisfy both isActive
 * and isDead. By gating on !isBillDead here, callers can rely on the
 * 3-way partition invariant:
 *
 *   - isActive=true,  isDead=false → moveable (citizen can still influence)
 *   - isActive=false, isDead=false → passed/chaptered (enacted law)
 *   - isActive=false, isDead=true  → vetoed, died, expired, etc.
 *   - isActive=true,  isDead=true  → impossible
 *
 * The bills-list "Active / Inactive" segmented toggle (#747) filters on
 * isActive; the personalized feed hard-excludes anything with isActive=false
 * (chaptered AND dead aren't actionable). isDead is retained for richer
 * categorisation in admin/research surfaces.
 */
export function isBillActive(
  bill: BillLifecycleInput,
  ctx: BillLifecycleContext,
): boolean {
  if (!bill.status) return false;
  if (!ACTIVE_STATUS_PATTERN.test(bill.status)) return false;
  return !isBillDead(bill, ctx);
}

/** Matches the canonical CA leginfo "Active Bill - …" prefix. Anything that
 *  doesn't begin with this prefix is treated as inactive — chaptered,
 *  vetoed, died, withdrawn, inactive file, or unknown. */
const ACTIVE_STATUS_PATTERN = /^active bill\b/i;
