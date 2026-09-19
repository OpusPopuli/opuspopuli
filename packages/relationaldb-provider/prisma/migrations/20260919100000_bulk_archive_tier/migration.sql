-- #1277 — bulk-archive tier: retained snapshots + per-record hashes.
--
-- Additive only. One new table, one nullable column on each of the six finance
-- row families. Existing rows keep a NULL hash deliberately: they were ingested
-- before hashing existed, and a value computed after the fact would claim the
-- row had been verified against a source it never was.

-- ---------------------------------------------------------------------------
-- Retained snapshots
--
-- Rows here are never deleted, only their payloads. `pruned_at` marks a
-- snapshot whose bytes have aged out under the retention schedule (latest plus
-- one per calendar month); the row stays so a finance row can still name the
-- export it came from. Deleting the row would break exactly the provenance
-- chain that outliving the bytes is meant to preserve.
-- ---------------------------------------------------------------------------

CREATE TABLE "bulk_snapshots" (
    "id" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "source_url" VARCHAR(1000) NOT NULL,
    "region_id" VARCHAR(100),
    "data_type" VARCHAR(50),
    -- BIGINT, not INTEGER: a ~1 GB export is comfortably inside INT4 today,
    -- but this column exists to describe bulk exports and INT4 tops out at
    -- 2.1 GB. Cheap to be right now, a migration on a growing table later.
    "byte_size" BIGINT NOT NULL,
    "content_type" VARCHAR(255),
    "storage_bucket" VARCHAR(255),
    "storage_key" VARCHAR(1000),
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "etag" TEXT,
    "last_modified" VARCHAR(255),
    "pruned_at" TIMESTAMPTZ,
    "is_monthly" BOOLEAN NOT NULL DEFAULT false,
    "execution_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_snapshots_pkey" PRIMARY KEY ("id")
);

-- Content address: a re-fetch of a byte-identical export collides here rather
-- than storing a second copy of a gigabyte.
CREATE UNIQUE INDEX "bulk_snapshots_content_hash_key"
    ON "bulk_snapshots"("content_hash");

CREATE INDEX "bulk_snapshots_source_url_fetched_at_idx"
    ON "bulk_snapshots"("source_url", "fetched_at");
CREATE INDEX "bulk_snapshots_execution_id_idx"
    ON "bulk_snapshots"("execution_id");
CREATE INDEX "bulk_snapshots_region_id_data_type_fetched_at_idx"
    ON "bulk_snapshots"("region_id", "data_type", "fetched_at");
-- The retention sweep's working set: snapshots that still hold bytes.
CREATE INDEX "bulk_snapshots_pruned_at_idx"
    ON "bulk_snapshots"("pruned_at");

-- ON DELETE SET NULL, not CASCADE: an archived export must outlive the
-- bookkeeping of the run that fetched it.
ALTER TABLE "bulk_snapshots"
    ADD CONSTRAINT "bulk_snapshots_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Per-record hashes
--
-- SHA-256 of the raw export line, taken before parsing. Nullable columns with
-- no default are a catalogue-only change in Postgres 11+, so this is fast even
-- on contributions (18M rows / 7.5 GB).
-- ---------------------------------------------------------------------------

ALTER TABLE "contributions" ADD COLUMN "source_record_hash" VARCHAR(64);
ALTER TABLE "expenditures" ADD COLUMN "source_record_hash" VARCHAR(64);
ALTER TABLE "independent_expenditures" ADD COLUMN "source_record_hash" VARCHAR(64);
ALTER TABLE "cvr2_filings" ADD COLUMN "source_record_hash" VARCHAR(64);
ALTER TABLE "cvr_filings" ADD COLUMN "source_record_hash" VARCHAR(64);
ALTER TABLE "filing_summaries" ADD COLUMN "source_record_hash" VARCHAR(64);
