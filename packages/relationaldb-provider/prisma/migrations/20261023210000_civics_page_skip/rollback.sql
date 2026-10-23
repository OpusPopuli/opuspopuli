-- Rollback for 20261023210000_civics_page_skip. Deploy the pre-K1
-- application first: K1 code reads and writes these.
ALTER TABLE "glossary_entries" DROP COLUMN IF EXISTS "llm_digest",
                               DROP COLUMN IF EXISTS "llm_model";
ALTER TABLE "civics_blocks" DROP COLUMN IF EXISTS "config_hash",
                            DROP COLUMN IF EXISTS "source_text_hash";
DROP TABLE IF EXISTS "civics_page_extractions";
