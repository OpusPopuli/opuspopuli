-- Reverse of 20260917200000_analysis_source_text_hash.
--
-- Both columns are additive, so dropping them loses only the binding between
-- an analysis and the text version it cites — analyses themselves survive.
-- After a rollback, staleness detection falls back to the prompt-hash axis
-- alone (#1212 S5), which is where it was before this migration.

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "full_text_hash";
ALTER TABLE "propositions" DROP COLUMN IF EXISTS "analysis_source_text_hash";

-- Dropped after the column, never before: the generated column binds to this
-- function by OID and Postgres refuses to drop it while a dependency stands.
DROP FUNCTION IF EXISTS op_sha256_utf8_hex(text);
