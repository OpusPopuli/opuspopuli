-- Reverse of 20260918100000_ai_output_model_digest.
--
-- Additive columns only, so dropping them loses the weight-level attribution
-- but not the outputs or their prompt/model attribution. After a rollback,
-- provenance falls back to the tag alone — where it was before this migration.

ALTER TABLE "minutes"               DROP COLUMN IF EXISTS "summary_llm_digest";
ALTER TABLE "propositions"          DROP COLUMN IF EXISTS "analysis_llm_digest";
ALTER TABLE "legislative_committees"
  DROP COLUMN IF EXISTS "activity_summary_llm_digest",
  DROP COLUMN IF EXISTS "description_llm_digest";
ALTER TABLE "representatives"
  DROP COLUMN IF EXISTS "activity_summary_llm_digest",
  DROP COLUMN IF EXISTS "committees_summary_llm_digest",
  DROP COLUMN IF EXISTS "bio_llm_digest";
