-- Rollback for the D5 attempt counter. With the counter gone, the code that
-- reads it fails, so roll back the application first, or with this.
ALTER TABLE "minutes"
    DROP COLUMN IF EXISTS "summary_failed_attempts";
