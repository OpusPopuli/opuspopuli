-- Rollback for meetings Phase B step 4. Manifests lose their config axis
-- (hint edits stop re-deriving again); failed summaries are retried every
-- sync again. No manifest or summary content is touched.
ALTER TABLE "structural_manifests"
    DROP COLUMN IF EXISTS "config_hash";
ALTER TABLE "minutes"
    DROP COLUMN IF EXISTS "summary_failed_key";
