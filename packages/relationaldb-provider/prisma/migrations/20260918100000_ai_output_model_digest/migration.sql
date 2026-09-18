-- Record WHICH WEIGHTS produced each AI output, not just which tag
-- (opuspopuli#1281, M1 provenance foundation #1207 scope item 5).
--
-- ── Why the model name is not enough ─────────────────────────────────────
--
-- `ollama pull` replaces the weights behind an unchanged tag. So a stored
-- `*_llm_model` of 'qwen3.5:9b' does not identify what ran: it names a moving
-- pointer, and the row cannot say which target it had at the time. That is
-- unanswerable retrospectively, which is precisely when it is asked.
--
-- Not hypothetical precision. #1212 measured claim anchoring at 24.8% on
-- olmo-3:7b-instruct and 52.9% on olmo-3.1:32b-instruct; comparisons like that
-- only mean something if the weights behind each tag are identified. And
-- production is currently serving `qwen3.6:35b-a3b`, which is not the model
-- the AI roadmap assumes — exactly the kind of drift a digest makes visible.
--
-- ── Scope: generator outputs, not every llm_model column ──────────────────
--
-- Seventeen columns in this schema carry an llm model name. These seven are
-- the ones written by generators extending LlmGeneratorBase, which is where
-- #1281 puts enforcement: the base class assembles provenance, so the base
-- class is what can guarantee the digest is present.
--
-- Deliberately NOT included: the five relevance/briefing caches and
-- PersonalizedImpactCache (cache rows, regenerated freely rather than cited),
-- and StructuralManifest / PipelineExecution (run records, not model output).
-- CivicsBlock follows when CivicsSyncService is brought onto the base class.
--
-- ── Values ────────────────────────────────────────────────────────────────
--
-- The digest as reported by ollama's manifest listing, `sha256:`/`sha256-`
-- prefix stripped. Where a provider cannot resolve one the writer stores the
-- literal 'unknown' rather than NULL: "we could not determine it" and "we
-- never asked" are different claims, and only one of them is honest. NULL is
-- therefore reserved for rows written before this column existed.
--
-- Additive only, per #1168 and M1's acceptance criteria: no drops, no renames.

ALTER TABLE "representatives"
  ADD COLUMN IF NOT EXISTS "bio_llm_digest" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "committees_summary_llm_digest" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "activity_summary_llm_digest" VARCHAR(80);

ALTER TABLE "legislative_committees"
  ADD COLUMN IF NOT EXISTS "description_llm_digest" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "activity_summary_llm_digest" VARCHAR(80);

ALTER TABLE "propositions"
  ADD COLUMN IF NOT EXISTS "analysis_llm_digest" VARCHAR(80);

ALTER TABLE "minutes"
  ADD COLUMN IF NOT EXISTS "summary_llm_digest" VARCHAR(80);
