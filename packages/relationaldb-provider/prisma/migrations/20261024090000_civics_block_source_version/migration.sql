-- Civics S3 (docs/plans/civics-phase-b.md §3) — carry the SourceVersion id
-- onto the civics block extracted from it, as #1306 did for propositions and
-- minutes. The S3 extraction worker reloads a page from source_versions, so
-- the block can now name the exact bytes it came from.
--
-- Additive only: one nullable column, an index and a foreign key. No
-- backfill — existing blocks keep NULL until their page next extracts; the
-- bytes they came from were never archived, and a guess would be
-- indistinguishable from a link.

ALTER TABLE "civics_blocks" ADD COLUMN "source_version_id" TEXT;

CREATE INDEX "civics_blocks_source_version_id_idx"
    ON "civics_blocks"("source_version_id");

-- ON DELETE SET NULL, never CASCADE (#1276/#1280/#1306): an archive pruned
-- for space must not take the civic row with it.
--
-- Validated immediately: the table is small (tens of rows) and the column
-- is NULL in every one, so the verification scan is free.
ALTER TABLE "civics_blocks"
    ADD CONSTRAINT "civics_blocks_source_version_id_fkey"
    FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
