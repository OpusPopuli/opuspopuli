-- Meetings Phase B step 3 (docs/plans/meetings-phase-b.md §3, finding M4).
-- Additive only: nullable columns, one index, two foreign keys; no backfill.
-- Existing rows stay NULL — a null says "we do not know which run produced
-- this", where a back-dated guess would read as a real link (#1280). The next
-- sync stamps every meeting it upserts.

-- Attribution, copying minutes (#1280). source_url is the source's KEY url,
-- not the dated fetch url (step 2): the window changes daily, the page does not.
--
-- No source_version_id, unlike minutes: meetings come from list pages, and
-- list pages are not archived, so the column would be NULL on every row.
-- Adding it is additive once they are.
ALTER TABLE "meetings"
    ADD COLUMN "source_url"            TEXT,
    ADD COLUMN "pipeline_execution_id" TEXT,
    ADD COLUMN "manifest_id"           TEXT,
    ADD COLUMN "manifest_version"      INTEGER;

-- "Given an execution, list its rows" — the #1280 acceptance criterion.
CREATE INDEX "meetings_pipeline_execution_id_idx"
    ON "meetings"("pipeline_execution_id");

-- ON DELETE SET NULL, never CASCADE: pruning runs or manifests must not take
-- civic rows with them. Validated immediately — every row is NULL (~530).
ALTER TABLE "meetings"
    ADD CONSTRAINT "meetings_pipeline_execution_id_fkey"
    FOREIGN KEY ("pipeline_execution_id") REFERENCES "pipeline_executions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetings"
    ADD CONSTRAINT "meetings_manifest_id_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "structural_manifests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The minutes summary's skip key: input and config axes, beside the prompt and
-- model axes it already records (the representatives Phase B pattern). Rows
-- with no summary_prompt_hash (48 of 58 locally) read as stale and regenerate
-- once; attributed rows are stamped current at runtime, since the config hash
-- covers the node's EFFECTIVE settings, which a literal here could not know.
ALTER TABLE "minutes"
    ADD COLUMN "summary_source_hash" VARCHAR(64),
    ADD COLUMN "summary_config_hash" VARCHAR(64);
