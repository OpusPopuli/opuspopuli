-- Rollback for propositions Phase B skip columns. Drops only what was added;
-- the archived bytes and every analysis are untouched.
ALTER TABLE "propositions"
    DROP COLUMN IF EXISTS "embedding_model_digest",
    DROP COLUMN IF EXISTS "analysis_config_hash";
ALTER TABLE "source_versions"
    DROP COLUMN IF EXISTS "parser_version",
    DROP COLUMN IF EXISTS "parsed_text_hash",
    DROP COLUMN IF EXISTS "parsed_text";
