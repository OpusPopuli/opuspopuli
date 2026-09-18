-- Weight-level attribution for civics extraction (opuspopuli#1281).
--
-- CivicsBlock already carried llm_model, prompt_hash and prompt_version —
-- CivicsSyncService stamped them itself, which is why #873 ("llm_model left
-- NULL") was already fixed by the time anyone looked.
--
-- What it did NOT have was a way to inherit future additions to the
-- attribution set, because it built its own stamp instead of using the shared
-- one. It now extends LlmGeneratorBase, so this column is the first thing it
-- gets for free rather than by being remembered.
--
-- Same semantics as the seven columns in 20260918100000: the digest reported
-- by ollama's manifest listing with the sha256 prefix stripped, the literal
-- 'unknown' where a provider cannot resolve one, and NULL reserved for rows
-- written before this column existed.
--
-- Additive only (#1168).

ALTER TABLE "civics_blocks"
  ADD COLUMN IF NOT EXISTS "llm_digest" VARCHAR(80);
