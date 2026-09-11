-- Generator-family AI-output provenance (opuspopuli#1149, second half).
--
-- 20260910000000_ai_output_provenance covered the caches and the
-- proposition/bill analysis columns. This adds the same triple to the five
-- generator outputs that still had none: representative bios, committee
-- summaries, activity summaries (representatives AND committees),
-- legislative-committee descriptions, and minutes summaries.
--
-- `CivicsBlock` (prompt_hash + prompt_version + llm_model) remains the
-- reference pattern; column names are prefixed by the output they attribute,
-- because `representatives` carries THREE independently-generated AI texts
-- and one bare `prompt_hash` could not say which one it attributes.
--
-- ── Additive only ────────────────────────────────────────────────────────
-- 18 ADD COLUMNs. No drops, no renames, no type changes. Existing rows stay
-- NULL — the producing prompt/model was never recorded and is not
-- recoverable; that nullness is honest (see the issue).

ALTER TABLE "representatives"
  ADD COLUMN "bio_prompt_hash"                    VARCHAR(64),
  ADD COLUMN "bio_prompt_version"                 VARCHAR(20),
  ADD COLUMN "bio_llm_model"                      VARCHAR(80),
  ADD COLUMN "committees_summary_prompt_hash"     VARCHAR(64),
  ADD COLUMN "committees_summary_prompt_version"  VARCHAR(20),
  ADD COLUMN "committees_summary_llm_model"       VARCHAR(80),
  ADD COLUMN "activity_summary_prompt_hash"       VARCHAR(64),
  ADD COLUMN "activity_summary_prompt_version"    VARCHAR(20),
  ADD COLUMN "activity_summary_llm_model"         VARCHAR(80);

ALTER TABLE "legislative_committees"
  ADD COLUMN "description_prompt_hash"            VARCHAR(64),
  ADD COLUMN "description_prompt_version"         VARCHAR(20),
  ADD COLUMN "description_llm_model"              VARCHAR(80),
  ADD COLUMN "activity_summary_prompt_hash"       VARCHAR(64),
  ADD COLUMN "activity_summary_prompt_version"    VARCHAR(20),
  ADD COLUMN "activity_summary_llm_model"         VARCHAR(80);

ALTER TABLE "minutes"
  ADD COLUMN "summary_prompt_hash"                VARCHAR(64),
  ADD COLUMN "summary_prompt_version"             VARCHAR(20),
  ADD COLUMN "summary_llm_model"                  VARCHAR(80);
