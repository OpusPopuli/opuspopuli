-- AI-output provenance completeness (opuspopuli#1149, M0 integrity fix set).
--
-- The prompt-openness decision (#1143) makes hash attestation the platform's
-- integrity mechanism: every AI output should be able to prove which prompt
-- and which model produced it. `@opuspopuli/prompt-client` already returns
-- `{ promptText, promptHash, promptVersion }` from every fetch and the LLM
-- provider exposes getName()/getModelName() — but several writers discard
-- those values, leaving persisted AI text unattributable.
--
-- `CivicsBlock` (source_url + prompt_hash + prompt_version + llm_model +
-- extracted_at) is the reference pattern; naming here follows it.
--
-- ── Additive only ────────────────────────────────────────────────────────
-- 16 ADD COLUMNs. No drops, no renames, no type changes. Safe to apply
-- before or after the code that writes them: the columns are nullable and
-- older code simply ignores them.
--
-- ── Why every column is nullable with no DEFAULT ─────────────────────────
-- Existing rows CANNOT be backfilled — the producing prompt and model were
-- never recorded, so there is nothing to recover. A default would assert
-- that historical rows came from a model we cannot actually name, which is
-- exactly the false attribution this column set exists to prevent. NULL is
-- the honest value and keeps "unattributable" distinguishable from
-- "attributed to X".
--
-- ── No indexes ───────────────────────────────────────────────────────────
-- These are read alongside the row they annotate, never filtered on. An
-- index on a mostly-NULL column would cost writes and buy nothing.

-- 1. Relevance/summary caches: template_hash exists, model does not. Swap
--    LLM_MODEL and every cached explanation becomes unattributable.
ALTER TABLE "bill_relevance_cache"
  ADD COLUMN "llm_provider" VARCHAR(50),
  ADD COLUMN "llm_model"    VARCHAR(80);

ALTER TABLE "proposition_relevance_cache"
  ADD COLUMN "llm_provider" VARCHAR(50),
  ADD COLUMN "llm_model"    VARCHAR(80);

ALTER TABLE "representative_relevance_cache"
  ADD COLUMN "llm_provider" VARCHAR(50),
  ADD COLUMN "llm_model"    VARCHAR(80);

ALTER TABLE "committee_relevance_cache"
  ADD COLUMN "llm_provider" VARCHAR(50),
  ADD COLUMN "llm_model"    VARCHAR(80);

ALTER TABLE "briefing_summary_cache"
  ADD COLUMN "llm_provider" VARCHAR(50),
  ADD COLUMN "llm_model"    VARCHAR(80);

-- 2. Propositions already record analysis_prompt_hash; complete the triple.
ALTER TABLE "propositions"
  ADD COLUMN "analysis_prompt_version" VARCHAR(20),
  ADD COLUMN "analysis_llm_model"      VARCHAR(80);

-- 3. Bills record ai_summary_version, which is a CONTENT version — not the
--    prompt that produced the summary, and not the model that ran it.
ALTER TABLE "bills"
  ADD COLUMN "ai_summary_prompt_hash"    VARCHAR(64),
  ADD COLUMN "ai_summary_prompt_version" VARCHAR(20),
  ADD COLUMN "ai_summary_llm_model"      VARCHAR(80);
