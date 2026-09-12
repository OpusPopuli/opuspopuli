-- Widen every embedding column to vector(768) for the nomic-embed-text-v2-moe
-- cutover (opuspopuli#1156, roadmap R1; plan docs/plans/1156-embeddings-hard-cutover.md).
--
-- ── COORDINATED DEPLOY — READ THIS FIRST ─────────────────────────────────
--
-- This migration MUST ship in the same release as the application change that
-- sets EMBEDDING_DIMENSIONS = 768. A 384 image in front of a 768 column boots
-- fine — the startup assertion compares the provider to the constant and never
-- looks at the column — and then fails per row: writes throw "expected 768
-- dimensions, not 384" and petition retrieval throws "different vector
-- dimensions". Fail-loud, no corruption, but proposition embeddings silently
-- stop being written. Slice C adds a three-way assertion (provider == constant
-- == column width) so that window refuses to boot instead.
--
-- ── Why drop + re-add rather than ALTER ──────────────────────────────────
--
-- pgvector cannot change a vector's dimension in place, and a USING cast would
-- have to invent 384 values per row it cannot know. Same reasoning, and the
-- same shape, as 20260829000000_embedding_dimensions_384.
--
-- ── Why this is allowed to drop a populated column ───────────────────────
--
-- The additive-only rule exists so a rollback has somewhere to land. Measured
-- in production and reproduced locally 2026-09-11:
--
--     propositions.embedding        64 of 64 rows embedded
--     documents.embedding            0 of 1
--     default_embeddings_vectors     0 rows
--     bills                          5019 rows, no embedding column yet
--
-- 64 vectors, every one of them reconstructible from `title + summary`, which
-- this migration does not touch. Re-embedding the corpus is ~300ms. The
-- rollback is `down.sql` plus a backfill run, not a restore.
--
-- ── Why the source hashes are NULLed ─────────────────────────────────────
--
-- `embedding_source_hash` records the text a vector was built from. After this
-- runs, the vectors are gone but the hashes would still match — so the backfill
-- would treat every row as current and skip it forever. Same trap, same fix, as
-- the 384 migration.
--
-- ── Why HNSW, from empty ─────────────────────────────────────────────────
--
-- IVFFlat trains centroids from the rows present when the index is built.
-- Built against an empty column — exactly the state this leaves behind, since
-- the backfill is a separate run — it is degenerate until someone rebuilds it,
-- and nothing does. HNSW builds incrementally and is correct from empty. See
-- 20260828000000_proposition_embeddings.
--
-- ── These indexes are raw SQL and `prisma db push` drops them (#1168) ─────
--
-- Prisma cannot express HNSW, so these indexes exist only here. A `db push`
-- against this database drops all of them silently. That is what happened in
-- production on 2026-09-07.

-- ── propositions ─────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "propositions_embedding_hnsw_idx";

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "propositions" ADD COLUMN "embedding" vector(768);

-- Model identity in the staleness key (gap-analysis M1, landed early). Without
-- it, "which model produced this vector" is knowable only by remembering what
-- was deployed when — and a mixed-model corpus is undetectable by query.
ALTER TABLE "propositions" ADD COLUMN IF NOT EXISTS "embedding_model" VARCHAR(80);

UPDATE "propositions" SET "embedding_source_hash" = NULL;

CREATE INDEX "propositions_embedding_hnsw_idx"
  ON "propositions"
  USING hnsw ("embedding" vector_cosine_ops);

-- ── documents ────────────────────────────────────────────────────────────
--
-- No HNSW index here, deliberately and as before: this column holds a single
-- scan's own vector and nothing queries it. The similarity search runs against
-- `propositions`, which is indexed above.
ALTER TABLE "documents" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "documents" ADD COLUMN "embedding" vector(768);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding_model" VARCHAR(80);

-- ── bills (greenfield — add only, nothing to drop) ───────────────────────
--
-- 5019 rows today, none embedded. At the batched provider's measured rate
-- (~672ms per 64 texts, warm) a full backfill is roughly a minute of
-- inference — worth stating because the plan's "seconds, not a throttled batch
-- job" was written about the 64-row proposition corpus, not this one.
ALTER TABLE "bills" ADD COLUMN "embedding" vector(768);
ALTER TABLE "bills" ADD COLUMN "embedding_model" VARCHAR(80);
ALTER TABLE "bills" ADD COLUMN "embedding_source_hash" TEXT;

CREATE INDEX "bills_embedding_hnsw_idx"
  ON "bills"
  USING hnsw ("embedding" vector_cosine_ops);

-- ── knowledge RAG store ──────────────────────────────────────────────────
--
-- This table is NOT in the Prisma schema. `pgvector.provider.ts` creates it at
-- service init with `CREATE TABLE IF NOT EXISTS ... vector(${dimensions})`,
-- named `${project}_embeddings_vectors` — and `project` resolves to "default"
-- because nothing registers that config key, despite PROJECT being set in the
-- environment. Verified against the running database: the table is
-- `default_embeddings_vectors` at vector(384).
--
-- `IF NOT EXISTS` means raising VECTORDB_DIMENSIONS to 768 does NOTHING to an
-- existing table. Without this block the cutover looks green and the RAG path
-- fails on its first insert, at runtime, with no startup signal.
--
-- The drop is guarded rather than unconditional: 0 rows is what makes it safe,
-- so if that is ever untrue the migration stops instead of destroying content
-- that (unlike the columns above) is NOT reconstructible from other columns —
-- this table stores the only copy of its `content`.
DO $$
DECLARE
  row_count bigint;
BEGIN
  IF to_regclass('public.default_embeddings_vectors') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.default_embeddings_vectors' INTO row_count;
    IF row_count > 0 THEN
      RAISE EXCEPTION
        'default_embeddings_vectors holds % rows; refusing to drop. This table stores the only copy of its content — export or re-ingest before widening.',
        row_count;
    END IF;
    DROP TABLE public.default_embeddings_vectors;
  END IF;
END $$;

-- Recreated to match pgvector.provider.ts exactly, so the provider's
-- CREATE TABLE IF NOT EXISTS at next boot is a no-op rather than a second
-- opinion about the schema.
CREATE TABLE "default_embeddings_vectors" (
  id VARCHAR(255) PRIMARY KEY,
  document_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX "default_embeddings_vectors_embedding_hnsw_idx"
  ON "default_embeddings_vectors"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX "default_embeddings_vectors_document_id_idx"
  ON "default_embeddings_vectors" (document_id);

CREATE INDEX "default_embeddings_vectors_user_id_idx"
  ON "default_embeddings_vectors" (user_id);
