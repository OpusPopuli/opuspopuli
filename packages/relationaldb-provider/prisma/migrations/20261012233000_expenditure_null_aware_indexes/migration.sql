-- Indexes the nullable `date` / `payee_name` columns now require (#991).
--
-- Making those columns nullable changed two query shapes in ways the existing
-- indexes cannot serve. Both were measured with EXPLAIN ANALYZE against the
-- local 4,841,982-row `expenditures` table, which grows toward ~14M once the
-- resync admits the 9,044,935 rows this issue exists to admit.
--
-- ── 1. The public expenditure listing ────────────────────────────────────
--
-- `getExpenditures` now orders `date DESC NULLS LAST` — without NULLS LAST,
-- page one is 5.2M undated rows and recent spending is unreachable. But a
-- default B-tree is (date ASC NULLS LAST): read forward it yields
-- ASC NULLS LAST, read backward DESC NULLS FIRST. **DESC NULLS LAST matches
-- neither**, so `expenditures_date_idx` stops being usable for the ordering
-- entirely:
--
--   ORDER BY date DESC, amount DESC            ->  Index Scan Backward
--                                                  0.147 ms
--   ORDER BY date DESC NULLS LAST, amount DESC ->  Parallel Seq Scan + Sort
--                                                  1065 ms
--
-- A 7,000x regression on a public page, today, before the resync triples the
-- table. `expenditures_date_desc_amount_idx` below matches the ORDER BY
-- exactly so the Limit can stop after a page.
--
-- The partial predicate is not decoration: `committee_id IS NOT NULL` is the
-- listing's only filter (EXPN_CD line items are unattributed until the
-- cover-page linker resolves them, #980), and it is not in the key, so
-- without the predicate the planner must index-scan in order and filter —
-- degrading toward a full scan to the extent rows stay unlinked.
--
-- ── 2. The disclosure aggregates ─────────────────────────────────────────
--
-- `FundingBasisService` sums the undated and unattributed money per committee
-- set. `committee_id IN (...) AND date IS NULL` could only use
-- `expenditures_committee_id_idx` with a heap recheck: 5.23M of ~14M rows
-- will be NULL, far too unselective for a BitmapAnd against
-- `expenditures_date_idx`, and `_sum(amount)` needs the heap regardless. So a
-- cache-miss funding compute read every expenditure of the rep's committees
-- three times instead of once. The two partial indexes carry `amount` in the
-- payload so the aggregates are index-only.
--
-- ── 3. The source-export lookup ──────────────────────────────────────────
--
-- `asOfSource` reads the newest finance bulk snapshot. `bulk_snapshots`'
-- only candidate index leads with `region_id`, which that query does not
-- constrain, so it was a Seq Scan + Sort of a table that grows one row per
-- bulk fetch forever. Small today, monotonically worse.
--
-- ── Locking ──────────────────────────────────────────────────────────────
--
-- CREATE INDEX CONCURRENTLY is NOT available: Prisma runs each migration in
-- one transaction and CONCURRENTLY cannot run inside a transaction block —
-- the same constraint documented in
-- 20260809000000_contribution_expenditure_cover_page_join. A plain CREATE
-- INDEX takes SHARE on the table, so reads continue and WRITES BLOCK for the
-- build. Writes to `expenditures` happen only during a finance sync, so
-- apply this when no sync is running. Measured build time on 4.84M rows is
-- recorded in the #991 plan.
--
-- Rollback is safe and lossless: DROP INDEX on all four.

-- `id` is the pagination tiebreaker: 5.2M rows share date = NULL with heavy
-- duplication in amount, and without a unique final key offset pagination is
-- not reproducible between queries. It is in the key so the whole ORDER BY is
-- satisfied by the index rather than needing a sort for the last column.
CREATE INDEX "expenditures_date_desc_amount_idx"
  ON "expenditures" ("date" DESC NULLS LAST, "amount" DESC, "id" ASC)
  WHERE "committee_id" IS NOT NULL;

CREATE INDEX "expenditures_committee_undated_idx"
  ON "expenditures" ("committee_id") INCLUDE ("amount")
  WHERE "date" IS NULL;

CREATE INDEX "expenditures_committee_unattributed_idx"
  ON "expenditures" ("committee_id") INCLUDE ("amount")
  WHERE "payee_name" IS NULL;

CREATE INDEX "bulk_snapshots_data_type_fetched_idx"
  ON "bulk_snapshots" ("data_type", "fetched_at" DESC);
