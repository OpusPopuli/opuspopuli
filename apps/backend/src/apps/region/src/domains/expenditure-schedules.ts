/**
 * Which `EXPN_CD` schedules constitute money SPENT (#1367).
 *
 * Every figure the site publishes as "spent" must use this set. Summing all
 * schedules — which is what every funding aggregate did before this — counts
 * the same payment up to three times.
 *
 * Sourced from `CalAccess/CalFormat/cal_format_201.pdf`, shipped inside the
 * bulk archive. Not inferred:
 *
 * | schedule | dictionary description | in a spend total? |
 * |---|---|---|
 * | `E` | "Schedule E - **Payments Made**" | **yes** — Form 460 line 6 |
 * | `F450P5` | "Expenditures & Contributions Made" (Form 450 Part 5) | **yes** |
 * | `F461P5` | "Expenditures & Contributions Made" (Form 461 Part 5) | **yes** |
 * | `F465P3` | "Independent Expenditures Made" (Form 465 Part 3) | **yes** |
 * | `D` | "Schedule D - **Summary** of Expenditures - Support/Oppose" | no — memo |
 * | `G` | "Payments Made 'on behalf' of this Committee" | no — see below |
 *
 * On `G` the dictionary is explicit, and this is the part guesswork would have
 * got wrong:
 *
 * > "The 460 Schedule G is a special case where ALL entries on that form are
 * > really sub-itemizations for items that appear on the 460's Schedule E or
 * > Schedule F. Filers have the option of coding Schedule E/F sub-itemizations
 * > within Schedules E/F themselves, or separately on Schedule G."
 *
 * So `G` is *always* a child of a row already counted. Always, not sometimes.
 *
 * The data agrees independently. Across the 151,167 filings carrying Schedule
 * E and a populated `reported_expenditures`, agreement with the filer's own
 * Form 460 line 6 to within 0.1%:
 *
 * | rule | matches |
 * |---|---|
 * | E only | **62.9%** |
 * | E + G | 47.1% |
 * | E + D | 19.7% |
 * | all schedules (the old behaviour) | **14.0%** |
 *
 * Adding either memo schedule makes agreement with the source WORSE.
 *
 * Forms 450/461/465 are additive without risk: **0 of 201,432 filings** mix
 * Schedule E with F450P5/F461P5/F465P3 — a filing is one form — and those
 * filers have no Form 460 line 6 at all. Omitting them would understate the
 * spending of every committee that files a 450, 461 or 465 instead of a 460.
 *
 * Platform effect, measured 2026-10-14: $45.645B → **$30.116B**, with
 * $15.529B of memo and sub-itemized rows excluded.
 */
export const SPEND_SCHEDULES = ['E', 'F450P5', 'F461P5', 'F465P3'] as const;

/**
 * Prisma `where` fragment selecting rows that count as spending.
 *
 * A function rather than a shared object literal so no call site can mutate
 * the set for the others, and so every aggregate is visibly opting in.
 *
 * **`scheduleCode` is nullable.** Rows ingested before #992 mapped the column
 * carry null and are EXCLUDED here — they cannot be shown to be payments
 * rather than memos, and counting an unknown as spend is the error this fix
 * exists to remove. `FilingReconciliationService` already warns when it meets
 * them; a resync populates them.
 */
export function spentScheduleFilter(): { scheduleCode: { in: string[] } } {
  return { scheduleCode: { in: [...SPEND_SCHEDULES] } };
}
