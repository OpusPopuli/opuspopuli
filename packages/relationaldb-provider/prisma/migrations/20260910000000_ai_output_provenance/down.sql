-- Rollback for 20260910000000_ai_output_provenance (opuspopuli#1149).
--
-- Lossless in the sense that matters: these columns hold provenance ABOUT a
-- generation, never the generation itself. Dropping them loses the ability to
-- attribute rows written while they existed — it does not lose civic content.
--
-- Re-applying the up migration afterwards leaves those rows NULL, since the
-- producing prompt/model is not recoverable after the fact.

ALTER TABLE "bills"
  DROP COLUMN IF EXISTS "ai_summary_llm_model",
  DROP COLUMN IF EXISTS "ai_summary_prompt_version",
  DROP COLUMN IF EXISTS "ai_summary_prompt_hash";

ALTER TABLE "propositions"
  DROP COLUMN IF EXISTS "analysis_llm_model",
  DROP COLUMN IF EXISTS "analysis_prompt_version";

ALTER TABLE "briefing_summary_cache"         DROP COLUMN IF EXISTS "llm_model", DROP COLUMN IF EXISTS "llm_provider";
ALTER TABLE "committee_relevance_cache"      DROP COLUMN IF EXISTS "llm_model", DROP COLUMN IF EXISTS "llm_provider";
ALTER TABLE "representative_relevance_cache" DROP COLUMN IF EXISTS "llm_model", DROP COLUMN IF EXISTS "llm_provider";
ALTER TABLE "proposition_relevance_cache"    DROP COLUMN IF EXISTS "llm_model", DROP COLUMN IF EXISTS "llm_provider";
ALTER TABLE "bill_relevance_cache"           DROP COLUMN IF EXISTS "llm_model", DROP COLUMN IF EXISTS "llm_provider";
