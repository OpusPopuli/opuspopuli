-- Rollback for 20260911100000_generator_provenance (opuspopuli#1149).
--
-- Same contract as the 20260910000000 down: these columns hold provenance
-- ABOUT a generation, never the generation itself. Dropping them loses
-- attribution for rows written while they existed; it loses no civic content.
-- Re-applying the up leaves those rows NULL — not recoverable after the fact.

ALTER TABLE "representatives"
  DROP COLUMN "bio_prompt_hash",
  DROP COLUMN "bio_prompt_version",
  DROP COLUMN "bio_llm_model",
  DROP COLUMN "committees_summary_prompt_hash",
  DROP COLUMN "committees_summary_prompt_version",
  DROP COLUMN "committees_summary_llm_model",
  DROP COLUMN "activity_summary_prompt_hash",
  DROP COLUMN "activity_summary_prompt_version",
  DROP COLUMN "activity_summary_llm_model";

ALTER TABLE "legislative_committees"
  DROP COLUMN "description_prompt_hash",
  DROP COLUMN "description_prompt_version",
  DROP COLUMN "description_llm_model",
  DROP COLUMN "activity_summary_prompt_hash",
  DROP COLUMN "activity_summary_prompt_version",
  DROP COLUMN "activity_summary_llm_model";

ALTER TABLE "minutes"
  DROP COLUMN "summary_prompt_hash",
  DROP COLUMN "summary_prompt_version",
  DROP COLUMN "summary_llm_model";
