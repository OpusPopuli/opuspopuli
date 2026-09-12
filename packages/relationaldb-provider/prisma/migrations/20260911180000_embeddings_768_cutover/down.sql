-- Rollback of the 768 cutover (opuspopuli#1156, roadmap R1).
--
-- This restores the SHAPE, not the data. Every vector column ends up empty and
-- every source hash NULL, which is the correct landing place: a 384 column
-- holding vectors produced by a 768 model would be unrepresentable, and one
-- holding nothing is simply a corpus waiting for a backfill.
--
-- Recovery after running this is a re-embed with MiniLM — ~300ms for the 64
-- propositions — not a restore from backup. That is what made the forward
-- migration's drop of a populated column acceptable in the first place.
--
-- Bills lose their columns entirely: they were greenfield in the forward
-- migration, so there is nothing to preserve and nothing that predates it.

-- ── knowledge RAG store ──────────────────────────────────────────────────
-- Same guard as the forward migration, for the same reason: this table holds
-- the only copy of its `content`, so a non-empty one stops the rollback rather
-- than being discarded by it.
DO $$
DECLARE
  row_count bigint;
BEGIN
  IF to_regclass('public.default_embeddings_vectors') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.default_embeddings_vectors' INTO row_count;
    IF row_count > 0 THEN
      RAISE EXCEPTION
        'default_embeddings_vectors holds % rows; refusing to drop during rollback. Export or re-ingest first.',
        row_count;
    END IF;
    DROP TABLE public.default_embeddings_vectors;
  END IF;
END $$;

CREATE TABLE "default_embeddings_vectors" (
  id VARCHAR(255) PRIMARY KEY,
  document_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX "default_embeddings_vectors_embedding_hnsw_idx"
  ON "default_embeddings_vectors"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX "default_embeddings_vectors_document_id_idx"
  ON "default_embeddings_vectors" (document_id);

CREATE INDEX "default_embeddings_vectors_user_id_idx"
  ON "default_embeddings_vectors" (user_id);

-- ── bills ────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "bills_embedding_hnsw_idx";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "embedding_source_hash";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "embedding_model";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "embedding";

-- ── documents ────────────────────────────────────────────────────────────
ALTER TABLE "documents" DROP COLUMN IF EXISTS "embedding_model";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "documents" ADD COLUMN "embedding" vector(384);

-- ── propositions ─────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "propositions_embedding_hnsw_idx";

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "embedding_model";
ALTER TABLE "propositions" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "propositions" ADD COLUMN "embedding" vector(384);

-- The stored hashes refer to vectors that no longer exist. Without this the
-- backfill treats every row as current and skips it forever.
UPDATE "propositions" SET "embedding_source_hash" = NULL;

CREATE INDEX "propositions_embedding_hnsw_idx"
  ON "propositions"
  USING hnsw ("embedding" vector_cosine_ops);
