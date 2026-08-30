-- Correct the embedding column width to match the provider that actually runs
-- (opuspopuli#1074, subtask 7).
--
-- Both columns were declared `vector(1536)` — OpenAI ada-002's width — in the
-- baseline migration. The configured provider is Xenova `all-MiniLM-L6-v2`,
-- which produces **384**. Measured, not assumed: running the shipped provider
-- against real text returns a 384-element vector.
--
-- `documents.embedding` had never been written by anything, so the mismatch
-- was inert and invisible. #1074 is the first code to write either column, and
-- with 1536 in place every single write throws "Expected 1536 dimensions, got
-- 384" — the corpus backfill reports failed=52, and every scan degrades to
-- `unverified`. It fails safe, and it never works.
--
-- Unit tests did not catch it because they mock the embeddings provider, and a
-- mock returns whatever width the test author assumed. Only running the real
-- provider surfaced it.
--
-- ── Safety ───────────────────────────────────────────────────────────────
--
-- Both columns are empty in every environment:
--   * `documents.embedding` has never been written by any code path
--   * `propositions.embedding` was added yesterday and its backfill has never
--     succeeded, for the reason above
--
-- So this drops nothing real. The columns are dropped and re-added rather than
-- ALTERed because pgvector cannot change a vector's dimension in place, and a
-- USING cast would have to invent 1,152 values per row it cannot know.
--
-- If this ever runs somewhere with data in these columns, that data is by
-- definition the wrong width and unusable for comparison — re-running the
-- backfill is the recovery, and it is idempotent.

DROP INDEX IF EXISTS "propositions_embedding_hnsw_idx";

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "propositions" ADD COLUMN "embedding" vector(384);

-- Force a re-embed of anything that had recorded a hash: the stored hash refers
-- to a vector that no longer exists, and without this the backfill would treat
-- those rows as up to date and skip them forever.
UPDATE "propositions" SET "embedding_source_hash" = NULL;

CREATE INDEX "propositions_embedding_hnsw_idx"
  ON "propositions"
  USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "documents" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "documents" ADD COLUMN "embedding" vector(384);
