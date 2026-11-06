-- Campaign finance Phase B (docs/plans/campaign-finance-phase-b.md D3, D5).
-- Additive only: one new table, nullable columns, indexes and SET NULL foreign
-- keys. No backfill: a NULL says "not recorded", where a guess would read as
-- a real link (#1280). The next sync stamps what it writes.

-- D3: the last completed import of each bulk source, and the key it ran under.
-- A row may be skipped as unchanged only when this matches the current key, so
-- an import that died partway never licenses a skip.
CREATE TABLE "bulk_imports" (
    "id"           TEXT NOT NULL,
    "source_key"   VARCHAR(1000) NOT NULL,
    "import_key"   VARCHAR(64) NOT NULL,
    "execution_id" TEXT,
    "completed_at" TIMESTAMPTZ NOT NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ NOT NULL,
    CONSTRAINT "bulk_imports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bulk_imports_source_key_key" ON "bulk_imports"("source_key");
ALTER TABLE "bulk_imports"
    ADD CONSTRAINT "bulk_imports_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- D5: every run that read an export points at its snapshot. Until now only the
-- first run to fetch a given export was linked (bulk_snapshots.execution_id),
-- because the archive dedupes by content hash (F5).
ALTER TABLE "pipeline_executions" ADD COLUMN "bulk_snapshot_id" TEXT;
CREATE INDEX "pipeline_executions_bulk_snapshot_id_idx"
    ON "pipeline_executions"("bulk_snapshot_id");
ALTER TABLE "pipeline_executions"
    ADD CONSTRAINT "pipeline_executions_bulk_snapshot_id_fkey"
    FOREIGN KEY ("bulk_snapshot_id") REFERENCES "bulk_snapshots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- D5: the run that wrote each row, on the five finance tables that lacked it.
-- contributions has had it since #1280. Nullable with no default: a
-- catalogue-only change, no table rewrite.
ALTER TABLE "expenditures"             ADD COLUMN "pipeline_execution_id" TEXT;
ALTER TABLE "filing_summaries"         ADD COLUMN "pipeline_execution_id" TEXT;
ALTER TABLE "independent_expenditures" ADD COLUMN "pipeline_execution_id" TEXT;
ALTER TABLE "cvr_filings"              ADD COLUMN "pipeline_execution_id" TEXT;
ALTER TABLE "cvr2_filings"             ADD COLUMN "pipeline_execution_id" TEXT;

-- Plain indexes, for the reasons recorded in 20260918170000_row_producing_run:
-- Prisma cannot run CONCURRENTLY, and a partial index drifts from the model.
-- "Given an execution, list its rows" (#1280), and SET NULL on a pruned run
-- without a sequential scan.
CREATE INDEX "expenditures_pipeline_execution_id_idx"
    ON "expenditures"("pipeline_execution_id");
CREATE INDEX "filing_summaries_pipeline_execution_id_idx"
    ON "filing_summaries"("pipeline_execution_id");
CREATE INDEX "independent_expenditures_pipeline_execution_id_idx"
    ON "independent_expenditures"("pipeline_execution_id");
CREATE INDEX "cvr_filings_pipeline_execution_id_idx"
    ON "cvr_filings"("pipeline_execution_id");
CREATE INDEX "cvr2_filings_pipeline_execution_id_idx"
    ON "cvr2_filings"("pipeline_execution_id");

-- Foreign keys: ON DELETE SET NULL, never CASCADE. The two large tables
-- (expenditures 14M rows, filing_summaries 4M) add NOT VALID and then
-- validate, ending as an ordinary validated key like contributions'. In one
-- file this does NOT let writes through during the scan: Prisma runs the file
-- as one transaction, so the ADD's lock is held through VALIDATE (and the
-- CREATE INDEX above already blocks writes). Run it with the sync stopped.
-- Moving each VALIDATE to its own migration is what would avoid the lock.
ALTER TABLE "expenditures"
    ADD CONSTRAINT "expenditures_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "expenditures"
    VALIDATE CONSTRAINT "expenditures_pipeline_execution_id_fkey";
ALTER TABLE "filing_summaries"
    ADD CONSTRAINT "filing_summaries_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "filing_summaries"
    VALIDATE CONSTRAINT "filing_summaries_pipeline_execution_id_fkey";
ALTER TABLE "independent_expenditures"
    ADD CONSTRAINT "independent_expenditures_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cvr_filings"
    ADD CONSTRAINT "cvr_filings_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cvr2_filings"
    ADD CONSTRAINT "cvr2_filings_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
