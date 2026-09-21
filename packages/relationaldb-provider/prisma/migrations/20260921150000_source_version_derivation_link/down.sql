-- Rollback for #1306.
--
-- Drops the row → fetch links and the stored derivation. The archived bytes
-- in source_versions.content survive; what does not survive is the extracted
-- text, which cannot be regenerated — the CSS plan that produced it was
-- LLM-derived per page and was never stored. Any claim that resolved to a
-- passage before this rollback stops resolving after it.
ALTER TABLE "minutes"
    DROP CONSTRAINT IF EXISTS "minutes_source_version_id_fkey";
ALTER TABLE "propositions"
    DROP CONSTRAINT IF EXISTS "propositions_source_version_id_fkey";

DROP INDEX IF EXISTS "minutes_source_version_id_idx";
DROP INDEX IF EXISTS "propositions_source_version_id_idx";
DROP INDEX IF EXISTS "source_versions_derived_text_hash_idx";

ALTER TABLE "minutes"      DROP COLUMN IF EXISTS "source_version_id";
ALTER TABLE "propositions" DROP COLUMN IF EXISTS "source_version_id";

ALTER TABLE "source_versions"
    DROP COLUMN IF EXISTS "derived_text",
    DROP COLUMN IF EXISTS "derived_text_hash";
