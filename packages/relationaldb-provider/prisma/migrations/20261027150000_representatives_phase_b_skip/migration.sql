-- Representatives Phase B (docs/plans/representatives-phase-b.md §1–2).
-- Additive only: nullable columns, one index, one foreign key; no backfill in
-- SQL. Legacy outputs are stamped current at runtime on the first sync (owner,
-- 2026-10-27), because the config hash includes the EFFECTIVE generation
-- settings, which a node can override — a literal here would be wrong there.

-- The skip key's input and config axes, and when each output was produced,
-- for every generated output on a representative. activity_summary_generated_at
-- already exists.
ALTER TABLE "representatives"
    ADD COLUMN "bio_source_hash"                 VARCHAR(64),
    ADD COLUMN "bio_config_hash"                 VARCHAR(64),
    ADD COLUMN "bio_generated_at"                TIMESTAMPTZ,
    ADD COLUMN "committees_summary_source_hash"  VARCHAR(64),
    ADD COLUMN "committees_summary_config_hash"  VARCHAR(64),
    ADD COLUMN "committees_summary_generated_at" TIMESTAMPTZ,
    ADD COLUMN "activity_summary_source_hash"    VARCHAR(64),
    ADD COLUMN "activity_summary_config_hash"    VARCHAR(64),
    -- Attribution: the archived page this rep was extracted from (the civics
    -- shape; the gold-eval plan's D8, never filed — searched 2026-10-27).
    ADD COLUMN "source_version_id"               TEXT;

CREATE INDEX "representatives_source_version_id_idx"
    ON "representatives"("source_version_id");

-- ON DELETE SET NULL, never CASCADE (#1276/#1280/#1306): an archive pruned
-- for space must not take the civic row with it. Validated immediately: the
-- column is NULL in every row (~125), so the verification scan is free.
ALTER TABLE "representatives"
    ADD CONSTRAINT "representatives_source_version_id_fkey"
    FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The same axes for a committee's generated outputs. activity_summary_generated_at
-- already exists.
ALTER TABLE "legislative_committees"
    ADD COLUMN "description_source_hash"      VARCHAR(64),
    ADD COLUMN "description_config_hash"      VARCHAR(64),
    ADD COLUMN "description_generated_at"     TIMESTAMPTZ,
    ADD COLUMN "activity_summary_source_hash" VARCHAR(64),
    ADD COLUMN "activity_summary_config_hash" VARCHAR(64);
