-- Rollback for civics S3. Drops only the block → fetch link; the archived
-- bytes in source_versions survive, and the blocks themselves are untouched.
ALTER TABLE "civics_blocks"
    DROP CONSTRAINT IF EXISTS "civics_blocks_source_version_id_fkey";
DROP INDEX IF EXISTS "civics_blocks_source_version_id_idx";
ALTER TABLE "civics_blocks" DROP COLUMN IF EXISTS "source_version_id";
